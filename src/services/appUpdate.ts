/*
 * appUpdate Service — 应用更新（检测 / 下载 / 安装）的 IPC 桥接.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：Renderer 不做本地 IO，
 *   Electron / electron-updater 能力统一经 IPC 转发到 Main Process（见 electron/main/update.ts）。
 *
 * 事件驱动，注意时序：
 *   checkAppUpdate() 只负责「触发」，检查结果经 'update-can-available' 异步回来 ——
 *   调用方必须先订阅 onUpdateAvailability 再触发，否则会漏掉本次结果。
 *
 * 更新通道仅在打包后可用（依赖 resources/app-update.yml），开发态用 getAppInfo()
 * 的 packaged 字段判断，不要靠 try/catch 兜底。
 */

import type { ProgressInfo } from 'electron-updater'

/** 应用基本信息，对应主进程 'app:get-info' */
export interface AppInfo {
  version: string
  /** 是否为打包后的正式版本；false 时更新能力不可用 */
  packaged: boolean
}

/** 主进程 'update-can-available' 的 payload（见 electron/main/update.ts） */
export interface UpdateAvailability {
  /** 是否有可用更新 */
  update: boolean
  /** 当前版本 */
  version: string
  /** 可用更新的版本号；无更新时为 undefined */
  newVersion?: string
}

/** checkAppUpdate 的返回值：只表示「触发」是否成功，不代表有无新版本 */
export type UpdateCheckOutcome = { ok: true } | { ok: false; message: string }

/** 读取应用版本与打包状态；失败时返回空版本 + packaged=false（视为不可更新） */
export async function getAppInfo(): Promise<AppInfo> {
  try {
    const result = (await window.ipcRenderer.invoke('app:get-info')) as Partial<AppInfo> | undefined
    return {
      version: typeof result?.version === 'string' ? result.version : '',
      packaged: result?.packaged === true,
    }
  } catch {
    return { version: '', packaged: false }
  }
}

/**
 * 触发一次更新检查。
 * 非打包态与网络异常都会走失败分支（主进程返回 { message, error }）。
 */
export async function checkAppUpdate(): Promise<UpdateCheckOutcome> {
  try {
    const result = (await window.ipcRenderer.invoke('check-update')) as
      | { message?: string; error?: unknown }
      | undefined
    if (result && typeof result === 'object' && result.error) {
      return { ok: false, message: result.message ?? '检查更新失败' }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '检查更新失败' }
  }
}

/** 订阅「检查结果」；返回取消订阅函数 */
export function onUpdateAvailability(
  listener: (payload: UpdateAvailability) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: UpdateAvailability) =>
    listener(payload)
  window.ipcRenderer.on('update-can-available', handler)
  return () => window.ipcRenderer.off('update-can-available', handler)
}

/** 订阅「下载进度」 */
export function onUpdateProgress(listener: (info: ProgressInfo) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, info: ProgressInfo) => listener(info)
  window.ipcRenderer.on('download-progress', handler)
  return () => window.ipcRenderer.off('download-progress', handler)
}

/** 订阅「下载完成」 */
export function onUpdateDownloaded(listener: () => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent) => listener()
  window.ipcRenderer.on('update-downloaded', handler)
  return () => window.ipcRenderer.off('update-downloaded', handler)
}

/** 订阅「更新出错」（主进程在下载阶段发送） */
export function onUpdateError(listener: (message: string) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: { message?: string }) =>
    listener(payload?.message ?? '更新失败')
  window.ipcRenderer.on('update-error', handler)
  return () => window.ipcRenderer.off('update-error', handler)
}

/** 开始下载已发现的更新（进度经 onUpdateProgress 回来） */
export async function startAppUpdateDownload(): Promise<void> {
  await window.ipcRenderer.invoke('start-download')
}

/** 取消下载（主进程会重置 CancellationToken，取消后无事件通知，由调用方自行回退状态） */
export async function cancelAppUpdateDownload(): Promise<void> {
  await window.ipcRenderer.invoke('cancel-download')
}

/** 退出并安装已下载的更新（交由 NSIS 安装器接管，进程会退出） */
export async function quitAndInstallAppUpdate(): Promise<void> {
  await window.ipcRenderer.invoke('quit-and-install')
}
