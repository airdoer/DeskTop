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

/**
 * 获取本机系统信息.
 * @param forceRefresh 为 true 时强制刷新网卡元数据缓存（用户手动点刷新时使用），
 *                     否则复用主进程 5 分钟内的缓存，避免每次都查询网卡驱动描述。
 */
export async function getSystemInfo(forceRefresh = false): Promise<SystemInfo> {
  const result = await window.ipcRenderer.invoke('system-info:get', forceRefresh)
  return result as SystemInfo
}
