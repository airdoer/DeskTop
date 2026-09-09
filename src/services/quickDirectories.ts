/*
 * quickDirectories Service — 常用 Windows 资源管理器目录的 CRUD + 打开.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：shell.openPath / dialog / webUtils 等
 *   Electron API 禁止在 Renderer 直接调用，统一经 IPC Service 转发到 Main Process。
 */

export interface QuickDirectory {
  id: string
  name: string
  path: string
  /** 标识色（#rrggbb）。未设置时按 id 稳定派生，见 deriveDirectoryColor */
  color?: string
  /** 图标上的字母标识，最多 2 个字符。未设置时按名称派生，见 deriveDirectoryBadge */
  badge?: string
}

export const MAX_QUICK_DIRECTORIES = 5

/** 可选标识色：取自既有语义色板（与 index.css tokens 同源），低饱和、克制 */
export const DIRECTORY_COLORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '#1677ff', label: '蓝' },
  { value: '#13c2c2', label: '青' },
  { value: '#52c41a', label: '绿' },
  { value: '#faad14', label: '金' },
  { value: '#fa8c16', label: '橙' },
  { value: '#f5222d', label: '红' },
  { value: '#722ed1', label: '紫' },
  { value: '#8c8c8c', label: '灰' },
]

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const CJK = /[一-鿿぀-ヿ가-힯]/

export function normalizeDirectoryColor(color?: string | null): string | undefined {
  if (!color) return undefined
  const value = color.trim()
  return HEX_COLOR.test(value) ? value.toLowerCase() : undefined
}

export function normalizeDirectoryBadge(badge?: string | null): string | undefined {
  if (!badge) return undefined
  const value = badge.trim().slice(0, 2)
  return value.length > 0 ? value : undefined
}

/** 未指定颜色时按 id 稳定派生，保证同一目录每次渲染颜色一致 */
export function deriveDirectoryColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return DIRECTORY_COLORS[hash % DIRECTORY_COLORS.length].value
}

/**
 * 由名称派生 ≤2 字符标识：
 *   - 中文/日文/韩文：取首字（小尺寸徽标下 1 个字比 2 个字清晰）
 *   - 多词英文名（Design Docs / design_docs / design-docs）：取前两个词首字母
 *   - 单词英文名（Design / MyDocs）：取前两个字母数字
 */
export function deriveDirectoryBadge(name: string): string {
  const raw = (name ?? '').trim()
  if (!raw) return ''
  if (CJK.test(raw[0])) return raw.slice(0, 1)
  const words = raw.split(/[\s._\-/\\]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).slice(0, 2).toUpperCase()
  const letters = raw.replace(/[^0-9A-Za-z]/g, '')
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase()
  return raw.slice(0, 2).toUpperCase()
}

export function resolveDirectoryColor(dir: QuickDirectory): string {
  return normalizeDirectoryColor(dir.color) ?? deriveDirectoryColor(dir.id || dir.path)
}

export function resolveDirectoryBadge(dir: QuickDirectory): string {
  return normalizeDirectoryBadge(dir.badge) ?? deriveDirectoryBadge(dir.name || dir.path)
}

export async function listQuickDirectories(): Promise<QuickDirectory[]> {
  const result = await window.ipcRenderer.invoke('quick-dirs:get')
  return (result as QuickDirectory[]) ?? []
}

export async function saveQuickDirectories(dirs: QuickDirectory[]): Promise<QuickDirectory[]> {
  const result = await window.ipcRenderer.invoke('quick-dirs:set', dirs)
  return (result as QuickDirectory[]) ?? []
}

export async function openDirectory(targetPath: string): Promise<{ ok: boolean; error?: string }> {
  const result = await window.ipcRenderer.invoke('quick-dirs:open', targetPath)
  return result as { ok: boolean; error?: string }
}

export async function pickDirectory(): Promise<{ name: string; path: string } | null> {
  const result = await window.ipcRenderer.invoke('quick-dirs:pick')
  return result as { name: string; path: string } | null
}

export interface PathStat {
  path: string
  name: string
  exists: boolean
  isDirectory: boolean
}

/** 探测路径类型，用于拖拽落盘的目录校验 */
export async function statPath(targetPath: string): Promise<PathStat> {
  const result = await window.ipcRenderer.invoke('path:stat', targetPath)
  return result as PathStat
}

/**
 * 从拖拽/选择得到的 File 解析磁盘绝对路径。
 * Electron ≥ 32 使用 webUtils.getPathForFile（preload 暴露）；失败时降级到已废弃的 file.path。
 */
export function getDroppedFilePath(file: File): string | null {
  try {
    const resolved = window.ipcRenderer.getPathForFile?.(file)
    if (resolved) return resolved
  } catch {
    /* 非 Electron 环境或 preload 未就绪，走降级分支 */
  }
  const legacy = (file as File & { path?: string }).path
  return typeof legacy === 'string' && legacy.length > 0 ? legacy : null
}
