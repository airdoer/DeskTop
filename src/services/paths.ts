/*
 * paths Service — 路径相关的通用 Desktop 能力（在资源管理器中打开）.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：shell.openPath 禁止在 Renderer 直接调用，
 *   统一经 IPC Service 转发到 Main Process。
 *
 * 该能力由「常用目录」与「P4 工作区」共用，因此独立于具体业务 Service 存在。
 */

export interface OpenPathResult {
  ok: boolean
  error?: string
}

/** 在系统文件管理器中打开指定路径（Windows 为资源管理器） */
export async function openPath(targetPath: string): Promise<OpenPathResult> {
  const result = await window.ipcRenderer.invoke('path:open', targetPath)
  return (result as OpenPathResult) ?? { ok: false, error: '无响应' }
}
