import type { P4Workspace } from './p4Workspaces'

/*
 * p4Paths Service — 本地路径 ↔ P4 路径互转（纯逻辑，可单测）.
 *
 * 原理：P4 工作区快照（client / Root / Stream）已经包含「本地根 ↔ 分支流」的映射关系，
 *   因此只要把输入路径归约成「分支流 + 相对路径」，就能推导出三条分支的全部路径：
 *
 *   相对路径 rel = Server/config/local/c7_dev.generated.json
 *   Mainline   //C7/Development/Mainline/rel  →  <Mainline 工作区 Root>\rel
 *   Preonline  //C7/Release/Preonline/rel     →  <Preonline 工作区 Root>\rel
 *   Online     //C7/Release/Online/rel        →  <Online 工作区 Root>\rel
 *
 * 输入可以是 6 个路径中的任意一个（3 条分支 × 本地/P4），输出恒为全部 6 个。
 *   某条分支在本机没有工作区时，仍给出 P4 路径，本地路径留空（UI 置灰并禁用跳转）。
 */

/** 分支映射表：这三个前缀是项目约定，新增分支在此追加即可 */
export interface StreamMapping {
  key: 'mainline' | 'preonline' | 'online'
  label: string
  stream: string
}

export const STREAM_MAPPINGS: StreamMapping[] = [
  { key: 'mainline', label: 'Mainline', stream: '//C7/Development/Mainline' },
  { key: 'preonline', label: 'Preonline', stream: '//C7/Release/Preonline' },
  { key: 'online', label: 'Online', stream: '//C7/Release/Online' },
]

export type PathKind = 'local' | 'depot'

/** 单条分支的推导结果：P4 路径恒有，本地路径在本机缺工作区时为空 */
export interface PathEntry {
  key: StreamMapping['key']
  label: string
  stream: string
  depotPath: string
  /** 本机该分支工作区对应的本地路径；无工作区时为 undefined */
  localPath?: string
  /** 命中的工作区 client 名 */
  workspaceName?: string
}

export interface ResolvedPaths {
  /** 输入的类型 */
  kind: PathKind
  /** 相对于分支根的路径（正斜杠），例如 Server/config/local/c7_dev.generated.json */
  relative: string
  /** 输入所属的分支 */
  mapping: StreamMapping
  /** 输入命中的工作区（depot 输入且本机无该分支工作区时为 undefined） */
  workspace?: P4Workspace
  /** 三条分支 ×（P4 路径 / 本地路径）共 6 条 */
  entries: PathEntry[]
}

export type ResolveResult =
  | { ok: true; value: ResolvedPaths }
  | { ok: false; error: string }

/* ---------- 输入归一化 ---------- */

/**
 * 清理用户输入：去空白 / 包裹引号 / 零宽字符，并剥离 p4 修订后缀。
 * 从资源管理器「复制文件地址」得到的是 `"E:\a\b"`，从 P4V 复制 depot 路径可能带 `#head` / `#3`。
 */
export function normalizePathInput(raw: string): string {
  let value = (raw ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim()
    }
  }
  // 剥离 p4 修订/变更号后缀：//depot/a#3、//depot/a@123、//depot/a@123,456
  return value.replace(/(#\d+|@\d+(,\d+)?|#head|#none)$/i, '')
}

/** 判定输入是本地路径还是 P4 depot 路径；无法判定时返回 null */
export function classifyPath(value: string): PathKind | null {
  if (!value) return null
  if (value.startsWith('//')) return 'depot'
  if (/^[a-zA-Z]:[\\/]/.test(value)) return 'local'
  if (/^[\\/]{2}/.test(value)) return 'local' // UNC：\\server\share
  if (/^[\\/]/.test(value)) return 'local' // 单根路径：\Project\...
  return null
}

/** 统一本地路径形态：正斜杠转反斜杠、压缩重复分隔符、去尾部分隔符（保留 UNC 前缀） */
export function toLocalForm(value: string): string {
  if (!value) return ''
  const unc = /^[\\/]{2}/.test(value)
  let next = value.replace(/\//g, '\\').replace(/\\+/g, '\\')
  if (unc && !next.startsWith('\\\\')) next = `\\${next}`
  // 去尾部反斜杠，但保留盘符根（E:\）与 UNC 根（\\server），否则前缀匹配会失效
  const isRoot = /^[a-zA-Z]:\\?$/.test(next) || /^\\\\[^\\]+\\?$/.test(next)
  return isRoot ? next : next.replace(/\\$/, '')
}

/** 统一 depot 路径形态：// 开头、压缩重复斜杠、去尾部斜杠 */
export function toDepotForm(value: string): string {
  if (!value) return ''
  return `//${value.replace(/^[\\/]+/, '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')}`
}

/* ---------- 匹配 ---------- */

/**
 * 找到包含该本地路径的工作区。
 * 多个工作区嵌套时（如 E:\Project 与 E:\Project\C7）取 Root 最长的那个，
 * 保证相对路径计算正确。
 */
export function matchLocalWorkspace(
  workspaces: P4Workspace[],
  localPath: string,
): P4Workspace | undefined {
  const target = toLocalForm(localPath).toLowerCase()
  let best: P4Workspace | undefined
  let bestLength = -1
  for (const ws of workspaces) {
    const root = toLocalForm(ws.root ?? '').toLowerCase()
    if (!root) continue
    if (target === root || target.startsWith(`${root}\\`)) {
      if (root.length > bestLength) {
        best = ws
        bestLength = root.length
      }
    }
  }
  return best
}

/** 本地路径 → 相对路径（正斜杠）。输入等于工作区根时返回空串。 */
export function relativeFromLocal(ws: P4Workspace, localPath: string): string {
  const root = toLocalForm(ws.root ?? '')
  const target = toLocalForm(localPath)
  if (!root) return ''
  if (target.toLowerCase() === root.toLowerCase()) return ''
  const tail = target.slice(root.length).replace(/^\\+/, '')
  return tail.split('\\').join('/')
}

/** 在候选分支流中取与 depot 路径前缀匹配最长的那个 */
export function matchDepotStream(depotPath: string, streams: string[]): string | undefined {
  const target = toDepotForm(depotPath).toLowerCase()
  let best: string | undefined
  let bestLength = -1
  for (const stream of streams) {
    const prefix = toDepotForm(stream).toLowerCase()
    if (!prefix) continue
    if (target === prefix || target.startsWith(`${prefix}/`)) {
      if (prefix.length > bestLength) {
        best = stream
        bestLength = prefix.length
      }
    }
  }
  return best
}

/** depot 路径 → 相对路径（正斜杠）。输入等于分支根时返回空串。 */
export function relativeFromDepot(stream: string, depotPath: string): string {
  const prefix = toDepotForm(stream)
  const target = toDepotForm(depotPath)
  if (!prefix) return ''
  if (target.toLowerCase() === prefix.toLowerCase()) return ''
  return target.slice(prefix.length).replace(/^\/+/, '')
}

/** 按分支流精确查找本机工作区（忽略大小写与尾部斜杠） */
export function findWorkspaceByStream(
  workspaces: P4Workspace[],
  stream: string,
): P4Workspace | undefined {
  const target = toDepotForm(stream).toLowerCase()
  if (!target) return undefined
  return workspaces.find((ws) => toDepotForm(ws.stream ?? '').toLowerCase() === target)
}

/**
 * 判定某个工作区（或分支流）属于哪条分支映射。
 * 先按 Stream 前缀判定；Stream 缺失时退回按 client 名包含分支名判定
 * （client 常命名为 chenzhixu_C7_Mainline），提高容错。
 */
export function findMapping(stream?: string, workspaceName?: string): StreamMapping | undefined {
  if (stream) {
    const normalized = toDepotForm(stream).toLowerCase()
    const byStream = STREAM_MAPPINGS.find((m) => {
      const prefix = toDepotForm(m.stream).toLowerCase()
      return normalized === prefix || normalized.startsWith(`${prefix}/`)
    })
    if (byStream) return byStream
  }
  if (workspaceName) {
    const name = workspaceName.toLowerCase()
    return STREAM_MAPPINGS.find((m) => name.includes(m.label.toLowerCase()))
  }
  return undefined
}

/* ---------- 结果构造 ---------- */

/** 本地根 + 相对路径 → 本地完整路径（分隔符用反斜杠） */
export function joinLocalPath(root: string, relative: string): string {
  // 先归一化 root：p4 返回的 Root 也可能带正斜杠，直接拼接会得到混合分隔符的本地路径
  const base = toLocalForm(root ?? '')
  if (!relative) return base
  if (!base) return relative.split('/').join('\\')
  return `${base}\\${relative.split('/').join('\\')}`
}

/** 由相对路径推导三条分支的全部路径（3 个 P4 路径 + 本机存在工作区的本地路径） */
export function buildPathEntries(workspaces: P4Workspace[], relative: string): PathEntry[] {
  return STREAM_MAPPINGS.map((mapping) => {
    const ws = findWorkspaceByStream(workspaces, mapping.stream)
    return {
      key: mapping.key,
      label: mapping.label,
      stream: mapping.stream,
      depotPath: relative ? `${mapping.stream}/${relative}` : mapping.stream,
      workspaceName: ws?.name,
      localPath: ws ? joinLocalPath(ws.root, relative) : undefined,
    }
  })
}

/**
 * 主入口：把用户输入的任意一个路径解析为 6 条路径。
 * 失败时返回可直接展示的中文原因（UI 不做二次判断）。
 */
export function resolveP4Path(input: string, workspaces: P4Workspace[]): ResolveResult {
  const value = normalizePathInput(input)
  if (!value) return { ok: false, error: '请先粘贴路径' }

  const kind = classifyPath(value)
  if (!kind) {
    return {
      ok: false,
      error: '无法识别路径：请粘贴本地路径（E:\\Project\\...）或 P4 路径（//C7/...）',
    }
  }

  const list = Array.isArray(workspaces) ? workspaces : []
  if (list.length === 0) {
    return { ok: false, error: '本机没有可用的 P4 工作区，无法换算路径' }
  }

  let relative: string
  let mapping: StreamMapping | undefined
  let workspace: P4Workspace | undefined

  if (kind === 'local') {
    workspace = matchLocalWorkspace(list, value)
    if (!workspace) {
      return { ok: false, error: '该本地路径不在任何 P4 工作区的根目录下' }
    }
    relative = relativeFromLocal(workspace, value)
    mapping = findMapping(workspace.stream, workspace.name)
    if (!mapping) {
      return {
        ok: false,
        error: `工作区 ${workspace.name}${workspace.stream ? `（${workspace.stream}）` : ''} 不属于 Mainline / Preonline / Online`,
      }
    }
  } else {
    const depot = toDepotForm(value)
    const candidates = [
      ...STREAM_MAPPINGS.map((m) => m.stream),
      ...list.map((ws) => ws.stream ?? '').filter(Boolean),
    ]
    const stream = matchDepotStream(depot, candidates)
    if (!stream) {
      return { ok: false, error: '该 P4 路径不属于 Mainline / Preonline / Online 中的任何分支' }
    }
    mapping = findMapping(stream)
    if (!mapping) {
      return { ok: false, error: `分支 ${stream} 暂不支持转换（仅 Mainline / Preonline / Online）` }
    }
    relative = relativeFromDepot(stream, depot)
    workspace = findWorkspaceByStream(list, stream)
  }

  return {
    ok: true,
    value: { kind, relative, mapping, workspace, entries: buildPathEntries(list, relative) },
  }
}
