/*
 * p4Workspaces Service — 本地 Perforce 工作区查询.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：p4 命令行属于本机进程调用，
 *   Renderer 禁止直接 exec，统一经 IPC Service 转发到 Main Process。
 *
 * 数据来源链（Main 侧实现见 electron/main/ipc.ts + electron/main/p4.ts）：
 *   p4 set → P4PORT / P4USER / P4CLIENT
 *   p4 -ztag clients -u <user> → client / Root / Stream / Host
 *   仅保留 Root 在本机存在的工作区
 */

import { deriveDirectoryColor } from './quickDirectories'

export interface P4Workspace {
  /** client 名，如 chenzhixu_C7_Mainline */
  name: string
  /** 本地根目录，如 E:\Project\C7_project */
  root: string
  /** 关联的 stream，可选 */
  stream?: string
  host?: string
  exists: boolean
}

export interface P4WorkspaceSnapshot {
  available: boolean
  port?: string
  user?: string
  /** 当前默认 client（P4CLIENT） */
  client?: string
  /** P4CHARSET，打开 P4V 时透传（-C） */
  charset?: string
  workspaces: P4Workspace[]
  /** 被过滤掉的非本地 client 数量 */
  hiddenCount?: number
  error?: string
}

const EMPTY: P4WorkspaceSnapshot = { available: false, workspaces: [] }

export async function getP4Workspaces(): Promise<P4WorkspaceSnapshot> {
  try {
    const result = await window.ipcRenderer.invoke('p4:workspaces')
    const snapshot = result as P4WorkspaceSnapshot | undefined
    if (!snapshot || typeof snapshot !== 'object') return EMPTY
    return { ...snapshot, workspaces: Array.isArray(snapshot.workspaces) ? snapshot.workspaces : [] }
  } catch {
    // 主进程未注册该 handler（例如旧版本）时降级为空，不阻断页面渲染
    return EMPTY
  }
}

/** 工作区按名称排序（当前 client 不再置顶） */
export function sortWorkspaces(list: P4Workspace[]): P4Workspace[] {
  const next = list.slice()
  next.sort((a, b) => a.name.localeCompare(b.name))
  return next
}

/**
 * 按用户自定义顺序重排工作区。
 * customOrder 中列出的 client 按其位置排列；未列入的按名称序追加在后，
 * 这样新增的工作区不会丢失，也不会挤到已排序项之前。
 */
export function sortWorkspacesByOrder(
  list: P4Workspace[],
  customOrder: string[],
): P4Workspace[] {
  const position = new Map<string, number>()
  customOrder.forEach((name, idx) => position.set(name, idx))
  const next = list.slice()
  next.sort((a, b) => {
    const ai = position.has(a.name) ? position.get(a.name)! : Number.MAX_SAFE_INTEGER
    const bi = position.has(b.name) ? position.get(b.name)! : Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return a.name.localeCompare(b.name)
  })
  return next
}

/**
 * 由 client 名派生徽标文字（≤2 字符）。
 * P4 client 常见命名 `chenzhixu_C7_Mainline`：跳过用户名前缀，取后两段首字母 → "CM"。
 * 用户名后只剩一段时（`chenzhixu_onlineDesign`）取该段前两字符 → "ON"，避免单字母。
 */
export function deriveWorkspaceBadge(name: string): string {
  const parts = (name ?? '').split(/[\s._\-/\\]+/).filter(Boolean)
  if (parts.length === 0) return 'P4'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  // 丢弃第一段（通常是用户名），取后续两段首字母
  const tail = parts.slice(1)
  if (tail.length === 1) return tail[0].slice(0, 2).toUpperCase()
  return (tail[0][0] + tail[1][0]).slice(0, 2).toUpperCase()
}

/* ---------- 星标（收藏）---------- */

/**
 * 读取收藏的 P4 client 名列表。
 * 主进程净化（去重 / 限量，见 electron/main/p4.ts 的 normalizeFavoriteNames），
 * 这里只做最小防御：非数组返回空。
 */
export async function getP4Favorites(): Promise<string[]> {
  try {
    const result = await window.ipcRenderer.invoke('p4-favorites:get')
    return Array.isArray(result) ? (result as string[]) : []
  } catch {
    return []
  }
}

/**
 * 写入收藏列表（整体覆盖）。主进程会净化后再落盘，返回净化后的结果，
 * 这里回传给调用方以保证 UI 与持久化一致。
 */
export async function setP4Favorites(names: string[]): Promise<string[]> {
  try {
    const result = await window.ipcRenderer.invoke('p4-favorites:set', names)
    return Array.isArray(result) ? (result as string[]) : []
  } catch {
    return []
  }
}

/* ---------- 自定义排序 ---------- */

/** 读取用户拖动后的工作区 client 名顺序列表 */
export async function getP4WorkspaceOrder(): Promise<string[]> {
  try {
    const result = await window.ipcRenderer.invoke('p4-workspace-order:get')
    return Array.isArray(result) ? (result as string[]) : []
  } catch {
    return []
  }
}

/** 写入工作区顺序列表（整体覆盖），返回主进程净化后的结果 */
export async function setP4WorkspaceOrder(names: string[]): Promise<string[]> {
  try {
    const result = await window.ipcRenderer.invoke('p4-workspace-order:set', names)
    return Array.isArray(result) ? (result as string[]) : []
  } catch {
    return []
  }
}

/* ---------- 在 P4V 中打开 ---------- */

/** 打开 P4V 所需的连接信息，从快照透传，避免渲染层再访问 p4 set */
export interface P4VConnection {
  port?: string
  user?: string
  charset?: string
}

/**
 * 在 P4V 中打开指定 workspace。
 * 调用主进程 p4:open-p4v，传入 client 名与连接信息；
 * 主进程优先用 `p4vc.bat [-p] [-u] -c client [-C] workspacewindow [-s target]` 启动
 * （p4vc 找不到时回退 `p4v.exe -p4vc ...`）。
 *
 * target：要定位的文件/目录，本地路径或 depot 路径，对应 p4vc 的 -s。
 * 不传则只打开工作区窗口。
 */
export async function openInP4V(
  client: string,
  conn: P4VConnection,
  target?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await window.ipcRenderer.invoke('p4:open-p4v', {
      client,
      port: conn.port,
      user: conn.user,
      charset: conn.charset,
      target,
    })
    return (result as { ok: boolean; error?: string }) ?? { ok: false, error: '未知错误' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/* ---------- 徽标自定义（labels）---------- */

/** 单个 client 的自定义徽标：badge / color 均可选，缺省回退派生值 */
export interface WorkspaceLabel {
  badge?: string
  color?: string
}

/** client 名 → 自定义徽标的映射 */
export type WorkspaceLabels = Record<string, WorkspaceLabel>

/** 读取全部工作区徽标自定义 */
export async function getP4WorkspaceLabels(): Promise<WorkspaceLabels> {
  try {
    const result = await window.ipcRenderer.invoke('p4-workspace-labels:get')
    return (result as WorkspaceLabels) ?? {}
  } catch {
    return {}
  }
}

/** 整体覆盖写入徽标自定义（主进程净化后返回） */
export async function setP4WorkspaceLabels(labels: WorkspaceLabels): Promise<WorkspaceLabels> {
  try {
    const result = await window.ipcRenderer.invoke('p4-workspace-labels:set', labels)
    return (result as WorkspaceLabels) ?? {}
  } catch {
    return {}
  }
}

/**
 * 解析徽标文字：优先用用户自定义，回退 deriveWorkspaceBadge。
 * 与常用目录的 resolveDirectoryBadge 同构。
 */
export function resolveWorkspaceBadge(name: string, labels?: WorkspaceLabels): string {
  const custom = labels?.[name]?.badge?.trim().slice(0, 2)
  if (custom && custom.length > 0) return custom
  return deriveWorkspaceBadge(name)
}

/**
 * 解析徽标颜色：优先用用户自定义，回退 deriveDirectoryColor(name)。
 * 与常用目录的 resolveDirectoryColor 同构。
 */
export function resolveWorkspaceColor(name: string, labels?: WorkspaceLabels): string {
  const custom = labels?.[name]?.color?.trim()
  if (custom && /^#[0-9a-fA-F]{6}$/.test(custom)) return custom.toLowerCase()
  return deriveDirectoryColor(name)
}
