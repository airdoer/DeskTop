/*
 * appConfig Service — 本地配置（落盘目录 / 一键重置）的 IPC 桥接.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：Renderer 不做本地 IO，
 *   统一经 IPC 转发到 Main Process（实现见 electron/main/appConfig.ts）。
 *
 * 「打开配置目录」复用 services/paths.ts 的 openPath（path:open 通道），
 *   不新增业务命名通道 —— 这里只负责把目录路径取回来。
 */

export interface ConfigFileInfo {
  /** 落盘文件名 */
  file: string
  /** 中文说明（由 Main 侧的清单提供，保证与扫描/重置同源） */
  label: string
  /** 是否已落盘 */
  exists: boolean
  /** 字节数；未落盘时为 0 */
  size: number
}

export interface AppConfigInfo {
  /** 配置落盘目录（app.getPath('userData')） */
  directory: string
  files: ConfigFileInfo[]
  /** 已落盘的文件数 */
  existing: number
}

export interface AppConfigResetResult {
  /** 实际删除的文件数 */
  removed: number
  /** 删除后的最新状态 */
  info: AppConfigInfo
}

/** 读取失败时的兜底：面板按「目录未知、无配置项」降级展示，而不是空白或崩溃 */
const EMPTY_INFO: AppConfigInfo = { directory: '', files: [], existing: 0 }

/** 读取配置目录与文件清单；失败返回 EMPTY_INFO */
export async function getAppConfigInfo(): Promise<AppConfigInfo> {
  try {
    const result = (await window.ipcRenderer.invoke('app:get-config-info')) as
      | Partial<AppConfigInfo>
      | undefined
    if (!result || typeof result.directory !== 'string' || !Array.isArray(result.files)) {
      return EMPTY_INFO
    }
    // 跨进程数据没有编译期保证，这里显式收敛成服务层声明的形状
    return {
      directory: result.directory,
      files: result.files as ConfigFileInfo[],
      existing: typeof result.existing === 'number' ? result.existing : 0,
    }
  } catch {
    return EMPTY_INFO
  }
}

/** 删除全部本地配置；失败返回 null（调用方据此提示并保留确认框） */
export async function resetAppConfig(): Promise<AppConfigResetResult | null> {
  try {
    const result = (await window.ipcRenderer.invoke('app:reset-config')) as
      | Partial<AppConfigResetResult>
      | undefined
    if (!result?.info || typeof result.removed !== 'number') return null
    return { removed: result.removed, info: result.info }
  } catch {
    return null
  }
}
