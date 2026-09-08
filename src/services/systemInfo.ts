/*
 * systemInfo Service — 封装获取本机系统信息的 IPC 调用.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：Renderer 禁止直接调 Node/Electron API，
 *   必须通过 IPC Service（Desktop Service）访问 Main Process 能力。
 */

export interface SystemInfo {
  hostname: string
  ipv4: string
  ipv4List: string[]
  platform: NodeJS.Platform
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const result = await window.ipcRenderer.invoke('system-info:get')
  return result as SystemInfo
}
