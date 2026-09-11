import { describe, expect, it } from 'vitest'
import type { P4Workspace } from '../src/services/p4Workspaces'
import {
  buildPathEntries,
  classifyPath,
  findMapping,
  normalizePathInput,
  resolveP4Path,
  STREAM_MAPPINGS,
  toDepotForm,
  toLocalForm,
} from '../src/services/p4Paths'

/*
 * P4 路径互转测试.
 * 背景：项目固定三条分支（Mainline / Preonline / Online），本机各有对应的 workspace；
 * 输入 6 个路径中的任意一个，都应输出全部 6 个路径。
 */

const WORKSPACES: P4Workspace[] = [
  {
    name: 'chenzhixu_C7_Mainline',
    root: 'E:\\Project\\C7_project',
    stream: '//C7/Development/Mainline',
    exists: true,
  },
  {
    name: 'chenzhixu_C7_Preonline',
    root: 'E:\\Project\\C7_Preonline',
    stream: '//C7/Release/Preonline',
    exists: true,
  },
  {
    name: 'chenzhixu_C7_Online',
    root: 'E:\\Project\\C7_Online',
    stream: '//C7/Release/Online',
    exists: true,
  },
]

const LOCAL_INPUT = 'e:\\Project\\C7_project\\Server\\config\\local\\c7_dev.generated.json'
const DEPOT_INPUT = '//C7/Development/Mainline/Server/config/local/c7_dev.generated.json'
const RELATIVE = 'Server/config/local/c7_dev.generated.json'

/** 期望的 6 条路径：三条分支 ×（P4 / 本地） */
function expectedPaths(relative: string) {
  return [
    `//C7/Development/Mainline/${relative}`,
    'E:\\Project\\C7_project\\Server\\config\\local\\c7_dev.generated.json',
    `//C7/Release/Preonline/${relative}`,
    'E:\\Project\\C7_Preonline\\Server\\config\\local\\c7_dev.generated.json',
    `//C7/Release/Online/${relative}`,
    'E:\\Project\\C7_Online\\Server\\config\\local\\c7_dev.generated.json',
  ]
}

function flatten(entries: ReturnType<typeof buildPathEntries>): string[] {
  return entries.flatMap((entry) => [entry.depotPath, entry.localPath ?? ''])
}

describe('输入归一化', () => {
  it('剥离资源管理器复制带来的引号与首尾空白', () => {
    expect(normalizePathInput(`  "${LOCAL_INPUT}"  `)).toBe(LOCAL_INPUT)
  })

  it('剥离 P4V 复制带来的修订后缀', () => {
    expect(normalizePathInput(`${DEPOT_INPUT}#3`)).toBe(DEPOT_INPUT)
    expect(normalizePathInput(`${DEPOT_INPUT}#head`)).toBe(DEPOT_INPUT)
    expect(normalizePathInput(`${DEPOT_INPUT}@123`)).toBe(DEPOT_INPUT)
  })

  it('识别本地路径 / depot 路径 / 无法识别', () => {
    expect(classifyPath('E:\\Project\\C7_project')).toBe('local')
    expect(classifyPath('e:/Project/C7_project')).toBe('local')
    expect(classifyPath('//C7/Development/Mainline')).toBe('depot')
    expect(classifyPath('Server/config/local')).toBeNull()
  })

  it('统一分隔符形态：本地用反斜杠，depot 保留 // 前缀', () => {
    expect(toLocalForm('e:/Project/C7_project/')).toBe('e:\\Project\\C7_project')
    expect(toLocalForm('e:/Project//C7_project')).toBe('e:\\Project\\C7_project')
    expect(toDepotForm('//C7/Development/Mainline/')).toBe('//C7/Development/Mainline')
    expect(toDepotForm('//C7//Development/Mainline')).toBe('//C7/Development/Mainline')
  })
})

describe('resolveP4Path', () => {
  it('本地路径（大小写与斜杠混用）换算出全部 6 条路径', () => {
    const result = resolveP4Path('e:/Project/C7_project/Server/config/local/c7_dev.generated.json', WORKSPACES)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.relative).toBe(RELATIVE)
    expect(result.value.mapping.key).toBe('mainline')
    expect(result.value.workspace?.name).toBe('chenzhixu_C7_Mainline')
    expect(flatten(result.value.entries)).toEqual(expectedPaths(RELATIVE))
  })

  it('P4 路径换算出全部 6 条路径', () => {
    const result = resolveP4Path(DEPOT_INPUT, WORKSPACES)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('depot')
    expect(result.value.mapping.key).toBe('mainline')
    expect(flatten(result.value.entries)).toEqual(expectedPaths(RELATIVE))
  })

  it('从 Preonline / Online 的本地路径输入也能换算', () => {
    const preonline = resolveP4Path('E:\\Project\\C7_Preonline\\Server\\x.txt', WORKSPACES)
    expect(preonline.ok).toBe(true)
    if (!preonline.ok) return
    expect(preonline.value.mapping.key).toBe('preonline')
    expect(preonline.value.entries.map((e) => e.depotPath)).toEqual([
      '//C7/Development/Mainline/Server/x.txt',
      '//C7/Release/Preonline/Server/x.txt',
      '//C7/Release/Online/Server/x.txt',
    ])

    const online = resolveP4Path('//C7/Release/Online/Server/x.txt', WORKSPACES)
    expect(online.ok).toBe(true)
    if (!online.ok) return
    expect(online.value.mapping.key).toBe('online')
  })

  it('输入分支根目录时相对路径为空，输出三条分支根', () => {
    const result = resolveP4Path('E:\\Project\\C7_project', WORKSPACES)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.relative).toBe('')
    expect(flatten(result.value.entries)).toEqual([
      '//C7/Development/Mainline',
      'E:\\Project\\C7_project',
      '//C7/Release/Preonline',
      'E:\\Project\\C7_Preonline',
      '//C7/Release/Online',
      'E:\\Project\\C7_Online',
    ])
  })

  it('工作区 Root 带正斜杠时，输出的本地路径统一为反斜杠', () => {
    const mixed: P4Workspace[] = WORKSPACES.map((ws) =>
      ws.stream === '//C7/Release/Online' ? { ...ws, root: 'E:/Project/C7_Online' } : ws,
    )
    const result = resolveP4Path(LOCAL_INPUT, mixed)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const online = result.value.entries.find((e) => e.key === 'online')
    expect(online?.localPath).toBe(
      'E:\\Project\\C7_Online\\Server\\config\\local\\c7_dev.generated.json',
    )
  })

  it('本地路径不属于任何工作区时给出可读原因', () => {
    const result = resolveP4Path('D:\\Other\\file.txt', WORKSPACES)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('不在任何 P4 工作区')
  })

  it('不支持的分支给出可读原因', () => {
    const result = resolveP4Path('//C7/Development/Feature/New/server.txt', WORKSPACES)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('不属于')
  })

  it('空输入与无法识别的输入直接提示，不做猜测', () => {
    expect(resolveP4Path('   ', WORKSPACES)).toEqual({ ok: false, error: '请先粘贴路径' })
    const unknown = resolveP4Path('Server/config/local', WORKSPACES)
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toContain('无法识别路径')
  })

  it('没有工作区快照时拒绝换算', () => {
    const result = resolveP4Path(LOCAL_INPUT, [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('没有可用的 P4 工作区')
  })
})

describe('缺失工作区的分支', () => {
  it('只给 P4 路径，本地路径留空', () => {
    const withoutOnline = WORKSPACES.filter((ws) => ws.stream !== '//C7/Release/Online')
    const result = resolveP4Path(LOCAL_INPUT, withoutOnline)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const online = result.value.entries.find((e) => e.key === 'online')
    expect(online?.depotPath).toBe('//C7/Release/Online/Server/config/local/c7_dev.generated.json')
    expect(online?.localPath).toBeUndefined()
    expect(online?.workspaceName).toBeUndefined()
  })

  it('嵌套工作区取 Root 最长的一个，避免相对路径被上层截断', () => {
    const nested: P4Workspace[] = [
      { name: 'outer', root: 'E:\\Project', stream: '//C7/Development/Mainline', exists: true },
      {
        name: 'inner',
        root: 'E:\\Project\\C7_project',
        stream: '//C7/Development/Mainline',
        exists: true,
      },
    ]
    const result = resolveP4Path(LOCAL_INPUT, nested)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.workspace?.name).toBe('inner')
    expect(result.value.relative).toBe(RELATIVE)
  })
})

describe('分支判定', () => {
  it('Stream 缺失时退回按 client 名判定', () => {
    expect(findMapping(undefined, 'chenzhixu_C7_Preonline')?.key).toBe('preonline')
    expect(findMapping(undefined, 'chenzhixu_C7_Online')?.key).toBe('online')
  })

  it('按 Stream 前缀判定（忽略大小写与尾部斜杠）', () => {
    expect(findMapping('//c7/development/mainline/')?.key).toBe('mainline')
    expect(findMapping('//C7/Release/Preonline')?.key).toBe('preonline')
  })

  it('三条分支映射的 stream 是项目约定，变更需同步测试', () => {
    expect(STREAM_MAPPINGS.map((m) => m.stream)).toEqual([
      '//C7/Development/Mainline',
      '//C7/Release/Preonline',
      '//C7/Release/Online',
    ])
  })
})
