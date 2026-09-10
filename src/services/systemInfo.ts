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

/*
 * 系统编码（UTF-8）状态。
 * 判定口径与 Main 侧 electron/main/encoding.ts 保持一致（脚本「设置编码格式（需要以管理员运行）.bat」）：
 *   系统 ACP = 65001 且 P4CHARSET = utf8 视为「编码正确」。
 * 该接口是 electron/main/encoding.ts 中 EncodingStatus 的同构副本，改字段需同步。
 */
export interface EncodingStatus {
  ok: boolean
  acpOk: boolean
  /** 未执行校验（p4 不可用）时为 undefined，不参与结论 */
  charsetOk?: boolean
  acp?: string
  oemcp?: string
  maccp?: string
  p4Charset?: string
  note?: string
}

/** 修复脚本执行结果：ok 表示已发起提权启动，不代表脚本已跑完 */
export interface EncodingRepairResult {
  ok: boolean
  error?: string
  root?: string
  scriptPath?: string
}

/** 读取系统编码状态（系统代码页 + P4CHARSET） */
export async function getEncodingStatus(): Promise<EncodingStatus> {
  const result = await window.ipcRenderer.invoke('system-info:encoding')
  return result as EncodingStatus
}

/**
 * 执行编码修复脚本：由主进程定位 Mainline 工作区并以管理员权限运行其中的 bat。
 * 失败时返回 error，交由 UI 展示，不在此处弹 Toast（Service 层不控制反馈）。
 */
export async function runEncodingRepair(): Promise<EncodingRepairResult> {
  const result = await window.ipcRenderer.invoke('encoding:repair')
  return result as EncodingRepairResult
}
