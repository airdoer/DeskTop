import { describe, expect, it } from 'vitest'
// 与既有测试一致：vitest 未配置 @/ 别名，用相对路径引用
import {
  parseP4Set,
  parseTaggedClients,
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
