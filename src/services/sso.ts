/*
 * sso Service — 渲染层封装 SSO 登录与窗口控制的 IPC 调用.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：Renderer 禁止直接调 Node/Electron API，
 *   必须通过 IPC Service（Desktop Service）访问 Main Process 能力。
 *
 * 包含两部分：
 *   1. SSO 登录 session（getSsoSession / startSsoLogin / ssoLogout）
 *   2. 自定义窗口控制按钮（minimizeWindow / toggleMaximizeWindow / closeWindow / isWindowMaximized）
 *      去掉原生 titleBarOverlay 后，最小化/最大化/关闭由渲染层按钮触发，经 IPC 转发到主进程。
 */

/** SSO 登录态快照（与 electron/main/sso.ts 的 SsoSession 同构） */
export interface SsoSession {
  /** SSO 返回的用户名（邮箱前缀，如 chenzhixu） */
  username: string
  /** 登录时间（ISO 字符串） */
  loginAt: string
}

/** SSO 登录结果（与 electron/main/sso.ts 的 SsoResult 同构） */
export interface SsoResult {
  success: boolean
  username?: string
  error?: string
}

const EMPTY_SESSION: SsoSession | null = null

/** 读取本地 SSO session（启动时回显已登录用户） */
export async function getSsoSession(): Promise<SsoSession | null> {
  try {
    const result = await window.ipcRenderer.invoke('sso:get-session')
    const session = result as SsoSession | null | undefined
    if (!session || typeof session !== 'object') return EMPTY_SESSION
    if (typeof session.username !== 'string' || !session.username.trim()) return EMPTY_SESSION
    return {
      username: session.username.trim(),
      loginAt: typeof session.loginAt === 'string' ? session.loginAt : '',
    }
  } catch {
    // 主进程未注册该 handler（旧版本）时降级为未登录，不阻断页面渲染
    return EMPTY_SESSION
  }
}

/**
 * 启动 SSO 登录流程.
 * 主进程会弹出登录子窗口，用户完成登录后返回结果。
 * 成功时 username 即为 SSO 用户名；失败/取消返回 success=false + error。
 */
export async function startSsoLogin(): Promise<SsoResult> {
  try {
    const result = await window.ipcRenderer.invoke('sso:login')
    return (result as SsoResult) ?? { success: false, error: '无响应' }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 登出：清除本地 SSO session */
export async function ssoLogout(): Promise<{ ok: boolean }> {
  try {
    const result = await window.ipcRenderer.invoke('sso:logout')
    return (result as { ok: boolean }) ?? { ok: false }
  } catch {
    return { ok: false }
  }
}

/* ---------- 自定义窗口控制 ---------- */

/** 最小化主窗口 */
export async function minimizeWindow(): Promise<void> {
  try {
    await window.ipcRenderer.invoke('window:minimize')
  } catch {
    /* 主进程未注册时静默忽略 */
  }
}

/**
 * 切换主窗口最大化/还原.
 * @returns 切换后是否处于最大化状态
 */
export async function toggleMaximizeWindow(): Promise<boolean> {
  try {
    const result = await window.ipcRenderer.invoke('window:toggle-maximize')
    return (result as { ok: boolean; maximized: boolean })?.maximized ?? false
  } catch {
    return false
  }
}

/** 关闭主窗口 */
export async function closeWindow(): Promise<void> {
  try {
    await window.ipcRenderer.invoke('window:close')
  } catch {
    /* 主进程未注册时静默忽略 */
  }
}

/** 查询主窗口当前是否最大化（按钮图标切换用） */
export async function isWindowMaximized(): Promise<boolean> {
  try {
    const result = await window.ipcRenderer.invoke('window:is-maximized')
    return (result as { maximized: boolean })?.maximized ?? false
  } catch {
    return false
  }
}

/**
 * 订阅主窗口最大化状态变化（主进程主动推送）.
 * @returns 取消订阅函数
 */
export function subscribeMaximizedChanged(listener: (maximized: boolean) => void): () => void {
  // ipcRenderer.on 的 listener 签名是 (event, ...args)，我们只关心 args[0] 即 maximized
  const handler = (_event: unknown, maximized?: boolean) => {
    if (typeof maximized === 'boolean') listener(maximized)
  }
  window.ipcRenderer.on('window:maximized-changed', handler)
  return () => {
    try {
      window.ipcRenderer.off('window:maximized-changed', handler)
    } catch {
      /* 旧版本未注册时静默忽略 */
    }
  }
}
