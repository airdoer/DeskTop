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

/** SSO 登录态快照（与 electron/main/ssoCore.ts 的 SsoSession 同构，改必须同步） */
export interface SsoSession {
  /** SSO 返回的用户名（邮箱前缀，如 chenzhixu）；调试态下为被覆盖的调试用户名 */
  username: string
  /** 登录时间（ISO 字符串） */
  loginAt: string
  /** 是否处于「调试身份」态：username 是被覆盖的调试用户，不是真实登录用户 */
  impersonated?: boolean
  /** 被覆盖掉的真实登录用户名；仅 impersonated 为 true 时存在 */
  realUsername?: string
}

/** SSO 登录结果（与 electron/main/ssoCore.ts 的 SsoResult 同构） */
export interface SsoResult {
  success: boolean
  username?: string
  error?: string
}

/** 「设置 / 清除调试身份」的结果（与 electron/main/ssoCore.ts 的 ImpersonationResult 同构） */
export interface ImpersonationResult {
  ok: boolean
  session: SsoSession | null
  error?: string
}

const EMPTY_SESSION: SsoSession | null = null

/**
 * 把主进程返回的原始对象收敛成 SsoSession.
 * 主进程与渲染层是两次独立的序列化，字段缺失/类型漂移都可能发生，
 * 故这里做一次完整校验而不是直接断言——调试态字段缺失只会退化为「普通登录态」，不会崩。
 */
function toSsoSession(raw: unknown): SsoSession | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const username = typeof obj.username === 'string' ? obj.username.trim() : ''
  if (!username) return null
  const session: SsoSession = {
    username,
    loginAt: typeof obj.loginAt === 'string' ? obj.loginAt : '',
  }
  // impersonated 严格判 true：字符串 "false" / 缺省都视为非调试态
  if (obj.impersonated === true) {
    session.impersonated = true
    session.realUsername = typeof obj.realUsername === 'string' ? obj.realUsername.trim() : ''
  }
  return session
}

/** 读取本地 SSO session（启动时回显已登录用户） */
export async function getSsoSession(): Promise<SsoSession | null> {
  try {
    const result = await window.ipcRenderer.invoke('sso:get-session')
    return toSsoSession(result)
  } catch {
    // 主进程未注册该 handler（旧版本）时降级为未登录，不阻断页面渲染
    return EMPTY_SESSION
  }
}

/**
 * 设置 / 清除调试身份（自测用：以其他用户的视角运行本工具）.
 *
 * @param login 目标登录名；null / 空串表示恢复真实身份
 * @returns ok + 设置后的有效 session；失败时 error 为可直接展示的原因
 *
 * 覆盖值只存在于主进程内存中，**不落盘**，退出应用即恢复真实身份。
 */
export async function setImpersonatedUser(login: string | null): Promise<ImpersonationResult> {
  try {
    const result = await window.ipcRenderer.invoke('sso:set-impersonation', login)
    const raw = result as ImpersonationResult | undefined
    if (!raw || typeof raw !== 'object') return { ok: false, session: null, error: '无响应' }
    return {
      ok: raw.ok === true,
      session: toSsoSession(raw.session),
      error: typeof raw.error === 'string' ? raw.error : undefined,
    }
  } catch (e) {
    return { ok: false, session: null, error: e instanceof Error ? e.message : String(e) }
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
 * 设置主窗口置顶（always on top）.
 *
 * 传**目标值**而不是让主进程 toggle：Windows 上独立的 DevTools 窗口会覆盖主窗口的 topmost，
 * 主进程读 isAlwaysOnTop() 会得到 false —— 按它取反会出现「设不进去也取消不掉」的死循环。
 * 状态由调用方（TitleBar）持有并传入。
 *
 * @param value 目标状态
 * @returns 实际生效的状态
 */
export async function setWindowAlwaysOnTop(value: boolean): Promise<boolean> {
  try {
    const result = await window.ipcRenderer.invoke('window:set-always-on-top', value)
    return (result as { ok: boolean; alwaysOnTop: boolean })?.alwaysOnTop ?? value
  } catch {
    return value
  }
}

/** 查询主窗口当前是否置顶（按钮首帧状态用） */
export async function isWindowAlwaysOnTop(): Promise<boolean> {
  try {
    const result = await window.ipcRenderer.invoke('window:is-always-on-top')
    return (result as { alwaysOnTop: boolean })?.alwaysOnTop ?? false
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
