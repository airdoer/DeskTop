/*
 * quickDirectories Service — 常用 Windows 资源管理器目录的 CRUD + 打开.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：shell.openPath / dialog 等 Electron API
 *   禁止在 Renderer 直接调用，统一经 IPC Service 转发到 Main Process。
 */

export interface QuickDirectory {
  id: string
  name: string
  path: string
}

export const MAX_QUICK_DIRECTORIES = 5

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
