import { describe, expect, it } from 'vitest'
// 与既有测试一致：vitest 未配置 @/ 别名，用相对路径引用
import {
  buildP4VArgs,
  buildWindowsBatchCommand,
  parseP4Set,
  parseTaggedClients,
  quoteWindowsArg,
  selectLocalWorkspaces,
} from '../electron/main/p4'
import { deriveWorkspaceBadge, sortWorkspaces, type P4Workspace } from '../src/services/p4Workspaces'

/*
 * 样本取自本机真实输出：
 *   p4 set
 *   p4 -ztag clients -u chenzhixu
 * 其中含 Linux Root（swarm 临时 client）用于覆盖"非本地被过滤"分支。
 */

const P4_SET_OUTPUT = [
  'P4CHARSET=utf8 (set)',
  'P4CLIENT=chenzhixu_C7_Weekly (set)',
  'P4EDITOR=notepad (set)',
  'P4PORT=c7p4.office.it:1666 (set)',
  'P4USER=chenzhixu (set)',
  '',
].join('\n')

const P4_CLIENTS_OUTPUT = [
  '... client chenzhixu_C7_Design',
  '... Update 1743389413',
  '... Access 1743389796',
  '... Owner chenzhixu',
  '... Options noallwrite noclobber nocompress unlocked nomodtime normdir',
  '... Root E:\\Project\\C7_Design',
  '... Host GM0NGBW4',
  '... Type writeable',
  '... Description Created by chenzhixu.',
  '',
  '',
  '... client chenzhixu_C7_Mainline',
  '... Update 1765195709',
  '... Owner chenzhixu',
  '... Root E:\\Project\\C7_project',
  '... Host GM0NGBW4',
  '... Stream //C7/Development/Mainline',
  '',
  '',
  '... client chenzhixu_C7_Online',
  '... Root E:\\Project\\C7_Online',
  '... Stream //C7/Release/Online',
  '',
  '',
  '... client chenzhixu_C7_Weekly',
  '... Root D:\\Project\\C7_weekly',
  '',
  '',
  '... client swarm-1743390000-abc',
  '... Root /home/perforce/swarm/abc',
  '... Host build-linux-01',
  '',
  '',
].join('\n')

describe('parseP4Set', () => {
  it('解析 P4 环境变量，丢弃尾部来源说明', () => {
    expect(parseP4Set(P4_SET_OUTPUT)).toEqual({
      P4CHARSET: 'utf8',
      P4CLIENT: 'chenzhixu_C7_Weekly',
      P4EDITOR: 'notepad',
      P4PORT: 'c7p4.office.it:1666',
      P4USER: 'chenzhixu',
    })
  })

  it('兼容 (config \'...\') 形式的来源说明', () => {
    expect(parseP4Set("P4PORT=ssl:example:1666 (config 'D:\\.p4config')\n").P4PORT).toBe(
      'ssl:example:1666',
    )
  })

  it('忽略空行、非 P4 前缀行与无等号行', () => {
    const parsed = parseP4Set('PATH=C:\\Windows\njust text\n\nP4USER=bob (set)')
    expect(Object.keys(parsed)).toEqual(['P4USER'])
    expect(parsed.P4USER).toBe('bob')
  })
})

describe('parseTaggedClients', () => {
  it('按 "... client" 切分记录并提取 Root / Stream / Host', () => {
    const records = parseTaggedClients(P4_CLIENTS_OUTPUT)
    expect(records).toHaveLength(5)
    expect(records[0]).toMatchObject({
      client: 'chenzhixu_C7_Design',
      root: 'E:\\Project\\C7_Design',
      host: 'GM0NGBW4',
      owner: 'chenzhixu',
    })
    expect(records[1].stream).toBe('//C7/Development/Mainline')
    expect(records[4].root).toBe('/home/perforce/swarm/abc')
  })

  it('空输入与无标记输入都返回空数组（调用方据此提示解析失败）', () => {
    expect(parseTaggedClients('')).toEqual([])
    expect(parseTaggedClients('Perforce client error:\n\tsomething')).toEqual([])
  })
})

describe('selectLocalWorkspaces', () => {
  const records = parseTaggedClients(P4_CLIENTS_OUTPUT)
  const localRoots = new Set(['E:\\Project\\C7_project', 'E:\\Project\\C7_Online', 'D:\\Project\\C7_weekly'])
  const exists = (target: string) => localRoots.has(target)

  it('只保留根目录在本机存在的工作区', () => {
    const { workspaces } = selectLocalWorkspaces(records, exists)
    expect(workspaces.map((w) => w.root)).toEqual([
      'E:\\Project\\C7_project',
      'E:\\Project\\C7_Online',
      'D:\\Project\\C7_weekly',
    ])
  })

  it('统计被隐藏的非本地 client 数量', () => {
    const { hiddenCount } = selectLocalWorkspaces(records, exists)
    expect(hiddenCount).toBe(2)
  })

  it('输出按名称排序，与 p4 返回顺序无关（渲染稳定）', () => {
    const { workspaces } = selectLocalWorkspaces(records, exists)
    expect(workspaces.map((w) => w.name)).toEqual([
      'chenzhixu_C7_Mainline',
      'chenzhixu_C7_Online',
      'chenzhixu_C7_Weekly',
    ])
  })

  it('缺少 client 或 root 的记录视为无效，不计入隐藏数', () => {
    const { workspaces, hiddenCount } = selectLocalWorkspaces(
      [
        { client: '', root: 'E:\\a' },
        { client: 'ws-no-root', root: '' },
      ],
      exists,
    )
    expect(workspaces).toEqual([])
    expect(hiddenCount).toBe(0)
  })
})

describe('sortWorkspaces', () => {
  const list: P4Workspace[] = [
    { name: 'c_Online', root: 'E:\\o', exists: true },
    { name: 'c_Mainline', root: 'E:\\m', exists: true },
    { name: 'c_Weekly', root: 'D:\\w', exists: true },
  ]

  it('按名称排序，且不修改原数组', () => {
    const sorted = sortWorkspaces(list)
    expect(sorted.map((w) => w.name)).toEqual(['c_Mainline', 'c_Online', 'c_Weekly'])
    expect(list[0].name).toBe('c_Online')
  })
})

describe('deriveWorkspaceBadge', () => {
  it('跳过用户名前缀，取后两段首字母', () => {
    expect(deriveWorkspaceBadge('chenzhixu_C7_Mainline')).toBe('CM')
    expect(deriveWorkspaceBadge('chenzhixu_C7_Weekly')).toBe('CW')
  })

  it('用户名后只剩一段时取该段前两字符，避免出现单字母', () => {
    expect(deriveWorkspaceBadge('chenzhixu_onlineDesign')).toBe('ON')
  })

  it('单词名取前两个字母；空名回退 P4', () => {
    expect(deriveWorkspaceBadge('mainline')).toBe('MA')
    expect(deriveWorkspaceBadge('')).toBe('P4')
  })
})

/*
 * p4vc / p4v 启动参数.
 * 依据 p4vc help workspacewindow：
 *   p4vc.bat [-p port] [-u user] -c client [-C charset] workspacewindow [-s path]
 *   p4v.exe  -p4vc  ...（同上）
 * -s 必须放在子命令之后，用于直接定位到文件/目录（本地或 depot 路径）。
 */
describe('buildP4VArgs', () => {
  const conn = { port: 'c7p4.office.it:1666', user: 'chenzhixu', charset: 'utf8' }

  it('直接启动 p4v.exe 时带 -p4vc（兼容既有调用方式）', () => {
    expect(buildP4VArgs(conn, 'chenzhixu_C7_Mainline')).toEqual([
      '-p4vc',
      '-p',
      'c7p4.office.it:1666',
      '-u',
      'chenzhixu',
      '-c',
      'chenzhixu_C7_Mainline',
      '-C',
      'utf8',
      'workspacewindow',
    ])
  })

  it('用 p4vc 启动器时不重复 -p4vc：bat 内部已补该参数', () => {
    const args = buildP4VArgs(conn, 'chenzhixu_C7_Mainline', { viaP4vcLauncher: true })
    expect(args[0]).not.toBe('-p4vc')
    expect(args).toContain('workspacewindow')
    expect(args).toContain('-c')
  })

  it('带 -s 时定位参数放在 workspacewindow 之后', () => {
    const args = buildP4VArgs(conn, 'chenzhixu_C7_Mainline', {
      viaP4vcLauncher: true,
      target: 'E:\\Project\\C7_project\\Server\\config\\local\\c7_dev.generated.json',
    })
    expect(args.slice(-3)).toEqual([
      'workspacewindow',
      '-s',
      'E:\\Project\\C7_project\\Server\\config\\local\\c7_dev.generated.json',
    ])
  })

  it('target 为空或纯空白时不追加 -s', () => {
    expect(buildP4VArgs(conn, 'c', { target: '   ' })).not.toContain('-s')
    expect(buildP4VArgs(conn, 'c', {})).not.toContain('-s')
  })

  it('连接信息缺失时省略对应参数，client 与子命令始终保留', () => {
    expect(buildP4VArgs({}, 'chenzhixu_C7_Online', { viaP4vcLauncher: true })).toEqual([
      '-c',
      'chenzhixu_C7_Online',
      'workspacewindow',
    ])
  })
})

describe('quoteWindowsArg', () => {
  it('无空格无引号时不加引号', () => {
    expect(quoteWindowsArg('workspacewindow')).toBe('workspacewindow')
    expect(quoteWindowsArg('-s')).toBe('-s')
  })

  it('含空格时加引号', () => {
    expect(quoteWindowsArg('E:\\a b\\c.json')).toBe('"E:\\a b\\c.json"')
  })

  it('空字符串输出空引号对，避免参数丢失', () => {
    expect(quoteWindowsArg('')).toBe('""')
  })
})

describe('buildWindowsBatchCommand', () => {
  /*
   * 回归用例：p4vc.bat 装在 "C:\Program Files\Perforce\"（路径含空格）。
   * 旧写法把 .bat 路径单独加引号后交给 `cmd /s /c`，/s 会剥掉最外层引号，
   * 导致 cmd 在 "Program Files" 的空格处切断命令并报
   * "'C:\Program' is not recognized"，表现为点击无反应。
   */
  it('整条命令外层加引号，含空格的 .bat 路径保持被引号包裹', () => {
    const command = buildWindowsBatchCommand('C:\\Program Files\\Perforce\\p4vc.bat', [
      '-c',
      'chenzhixu_C7_Mainline',
    ])
    expect(command).toBe('"C:\\Program Files\\Perforce\\p4vc.bat" -c chenzhixu_C7_Mainline')
  })

  it('含空格的 -s 路径单独加引号，且不影响 .bat 路径的引号', () => {
    const command = buildWindowsBatchCommand('C:\\Program Files\\Perforce\\p4vc.bat', [
      'workspacewindow',
      '-s',
      'E:\\Project\\C7_project\\a b\\c.json',
    ])
    expect(command).toBe(
      '"C:\\Program Files\\Perforce\\p4vc.bat" workspacewindow -s "E:\\Project\\C7_project\\a b\\c.json"',
    )
  })

  it('拼进 cmd.exe 后，首个引号内是完整 .bat 路径（/s 剥掉最外层仍可解析）', () => {
    const command = buildWindowsBatchCommand('C:\\Program Files\\Perforce\\p4vc.bat', ['-c', 'x'])
    const argv = ['/d', '/s', '/c', `"${command}"`]
    // cmd /s 的规则：剥掉一整行最外面的一对引号
    const afterStrip = argv[3].slice(1, -1)
    const firstToken = afterStrip.slice(1, afterStrip.indexOf('"', 1))
    expect(firstToken).toBe('C:\\Program Files\\Perforce\\p4vc.bat')
  })
})
