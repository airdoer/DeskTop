/*
 * Perforce (p4) 本地工作区查询：纯逻辑部分（不含 Electron / IO）。
 * 独立成文件以便单元测试（见 test/p4-workspaces.test.ts）：
 * electron/main/ipc.ts 依赖 electron 模块，无法在 vitest 的 node 环境里直接 import。
 */

export interface P4ClientRecord {
  client: string
  root: string
  stream?: string
  host?: string
  owner?: string
}

export interface P4Workspace {
  name: string
  root: string
  stream?: string
  host?: string
  /** 根目录在本机是否存在（用于筛出"本地"工作区） */
  exists: boolean
}

/**
 * 解析 `p4 set` 输出。
 * 形如：P4PORT=c7p4.office.it:1666 (set) / P4CLIENT=xxx (config 'D:\.p4config')
 */
export function parseP4Set(output: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!key.startsWith('P4') && !key.startsWith('p4')) continue
    // 去掉尾部来源说明（" (set)" / " (config '...')"）
    let value = line.slice(eq + 1).trim()
    const paren = value.indexOf(' (')
    if (paren >= 0) value = value.slice(0, paren).trim()
    result[key.toUpperCase()] = value
  }
  return result
}

/**
 * 解析 `p4 -ztag clients` 输出。
 * 记录以 "... client <name>" 开始，字段形如 "... Root E:\Project\C7_project"。
 */
export function parseTaggedClients(output: string): P4ClientRecord[] {
  const records: P4ClientRecord[] = []
  let current: P4ClientRecord | null = null

  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('...')) {
      if (line === '' && current) {
        records.push(current)
        current = null
      }
      continue
    }
    const body = line.replace(/^\.\.\.\s*/, '')
    const sp = body.indexOf(' ')
    if (sp < 0) continue
    const key = body.slice(0, sp)
    const value = body.slice(sp + 1).trim()

    if (key === 'client') {
      if (current) records.push(current)
      current = { client: value, root: '' }
      continue
    }
    if (!current) continue
    if (key === 'Root') current.root = value
    else if (key === 'Stream') current.stream = value
    else if (key === 'Host') current.host = value
    else if (key === 'Owner') current.owner = value
  }

  if (current) records.push(current)
  return records
}

/**
 * 选出"本地"工作区：根目录在本机存在的才算。
 * 其余（含 Linux 路径 / 服务器上的 swarm 临时 client）计入 hiddenCount，便于 UI 提示。
 * 结果按名称排序，与 p4 返回顺序无关，保证渲染稳定。
 */
export function selectLocalWorkspaces(
  records: P4ClientRecord[],
  exists: (target: string) => boolean,
): { workspaces: P4Workspace[]; hiddenCount: number } {
  const workspaces: P4Workspace[] = []
  let hidden = 0

  for (const record of records) {
    if (!record.client || !record.root) {
      continue
    }
    const existing = exists(record.root)
    if (!existing) {
      hidden += 1
      continue
    }
    workspaces.push({
      name: record.client,
      root: record.root,
      stream: record.stream,
      host: record.host,
      exists: true,
    })
  }

  workspaces.sort((a, b) => a.name.localeCompare(b.name))
  return { workspaces, hiddenCount: hidden }
}

/* ---------- 星标（收藏）与 P4V 启动 ---------- */

/** 星标 client 名上限；client 名本身限制长度，防止异常长字符串进持久化文件 */
export const MAX_P4_FAVORITES = 50
const MAX_CLIENT_NAME_LENGTH = 128

/** 净化星标列表：仅接受非空字符串、去重、限量。独立成纯函数便于单测。 */
export function normalizeFavoriteNames(names: unknown): string[] {
  if (!Array.isArray(names)) return []
  const seen = new Set<string>()
  for (const item of names) {
    if (typeof item !== 'string') continue
    const name = item.trim().slice(0, MAX_CLIENT_NAME_LENGTH)
    if (!name) continue
    seen.add(name)
    if (seen.size >= MAX_P4_FAVORITES) break
  }
  return [...seen]
}

export interface P4Connection {
  port?: string
  user?: string
  charset?: string
}

export interface P4VOpenOptions {
  /**
   * 要定位的文件/目录，对应 p4vc 的 -s（支持本地路径与 depot 路径）。
   * 例：p4vc.bat -c chenzhixu_C7_Mainline workspacewindow -s "E:\Project\C7_project\Server\x.json"
   */
  target?: string
  /**
   * 是否直接用 p4vc 启动器（p4vc.bat / p4vc）。
   * p4vc 内部已补 `-p4vc`，重复传会被 p4v 当成未知参数，因此用 p4vc 时不能再加。
   * 直接启动 p4v.exe 时才需要 -p4vc。
   */
  viaP4vcLauncher?: boolean
}

/**
 * 构造「在 P4V 中打开指定 workspace」的命令行参数。
 * 两种调用形态（语法来自 p4vc help workspacewindow）：
 *   p4v.exe -p4vc [-p port] [-u user] [-c client] [-C charset] workspacewindow [-s path]
 *   p4vc.bat      [-p port] [-u user] [-c client] [-C charset] workspacewindow [-s path]
 * workspacewindow：为给定连接打开工作区窗口；若已打开则带到前台。
 * -s 必须放在子命令之后，用于直接定位到某个文件/目录。
 */
export function buildP4VArgs(
  conn: P4Connection,
  client: string,
  options: P4VOpenOptions = {},
): string[] {
  const args: string[] = []
  if (!options.viaP4vcLauncher) args.push('-p4vc')
  if (conn.port) args.push('-p', conn.port)
  if (conn.user) args.push('-u', conn.user)
  args.push('-c', client)
  if (conn.charset) args.push('-C', conn.charset)
  args.push('workspacewindow')
  const target = options.target?.trim()
  if (target) args.push('-s', target)
  return args
}
