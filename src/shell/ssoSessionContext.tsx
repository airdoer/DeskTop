import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  getSsoSession,
  setImpersonatedUser,
  startSsoLogin,
  ssoLogout,
  type SsoSession,
} from '@/services/sso'

/*
 * SsoSessionContext — 全应用共享的 SSO 登录态.
 * 依据 docs/UI_DESIGN_SYSTEM.md §3/§4：Shell 统一提供登录态，业务页面禁止自行管理。
 *
 * 之前 session 状态由 TitleBar 持有，仅向下传给 UserMenu；现在提升到 Context，
 * 让 LoginGate（未登录拦截）、UserMenu（登录按钮/颜色）、Redmine 面板（用登录用户名查询）
 * 都能读取同一份 session，避免多处各自拉取造成状态不一致。
 *
 * Context 只负责状态与 IPC 调用，不处理 Toast 反馈：
 *   - login() 返回 boolean 成功与否，由调用方决定 Toast 文案
 *   - logout() 无返回值，调用方自行 Toast
 *   - impersonate() 返回 { ok, error }，调用方决定 Toast 文案
 *   - 内部 loggingIn/loggingOut/impersonating 用于禁用按钮，避免重复触发
 *
 * 调试身份（impersonate）也放在这里，而不是 UserMenu 自己持状态：
 * session.username 一变，Redmine 面板、P4V 打开用户、标题栏问候语会同步跟着变，
 * 若覆盖值只活在 UserMenu 内部，就会出现「菜单显示 A、面板查的还是 B」的分裂。
 */

interface SsoSessionContextValue {
  /** 当前 session（未登录为 null） */
  session: SsoSession | null
  /** 是否已登录（session.username 非空） */
  loggedIn: boolean
  /** 首次加载中（启动时读 session 文件，完成前为 true，避免闪烁 LoginGate） */
  loading: boolean
  /** 登录流程进行中（禁用登录按钮） */
  loggingIn: boolean
  /** 登出流程进行中（禁用登出按钮） */
  loggingOut: boolean
  /** 切换调试身份进行中（禁用切换按钮，校验要打 Redmine 接口） */
  impersonating: boolean
  /** 发起 SSO 登录，返回是否成功 */
  login: () => Promise<boolean>
  /** 登出，清除本地 session */
  logout: () => Promise<void>
  /** 重新拉取 session（登录/登出后内部自动调用，也可手动刷新） */
  refresh: () => Promise<void>
  /**
   * 切换调试身份（自测用）.
   * @param login 目标登录名；null / 空串表示恢复真实身份
   * @returns ok=false 时 error 为可直接 Toast 的原因（查无此人 / 查询失败）
   */
  impersonate: (login: string | null) => Promise<{ ok: boolean; error?: string }>
}

const SsoSessionContext = createContext<SsoSessionContextValue | null>(null)

export function SsoSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SsoSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [impersonating, setImpersonating] = useState(false)

  const refresh = useCallback(async () => {
    const s = await getSsoSession()
    setSession(s)
    setLoading(false)
  }, [])

  // 启动时读一次本地 session（已登录则回显用户名）
  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (): Promise<boolean> => {
    if (loggingIn) return false
    setLoggingIn(true)
    try {
      const result = await startSsoLogin()
      if (result.success && result.username) {
        await refresh()
        return true
      }
      return false
    } finally {
      setLoggingIn(false)
    }
  }, [loggingIn, refresh])

  const logout = useCallback(async (): Promise<void> => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await ssoLogout()
      await refresh()
    } finally {
      setLoggingOut(false)
    }
  }, [loggingOut, refresh])

  /*
   * 切换调试身份.
   * 主进程完成「校验 + 写内存覆盖」后返回新的有效 session，这里直接用返回值 setSession，
   * 不再额外 refresh 一次：多一次 IPC 往返只是重复读同一个内存值。
   */
  const impersonate = useCallback(
    async (login: string | null): Promise<{ ok: boolean; error?: string }> => {
      if (impersonating) return { ok: false, error: '正在切换中' }
      setImpersonating(true)
      try {
        const result = await setImpersonatedUser(login)
        if (result.ok) setSession(result.session)
        return { ok: result.ok, error: result.error }
      } finally {
        setImpersonating(false)
      }
    },
    [impersonating],
  )

  const value: SsoSessionContextValue = {
    session,
    loggedIn: !!session?.username,
    loading,
    loggingIn,
    loggingOut,
    impersonating,
    login,
    logout,
    refresh,
    impersonate,
  }

  return <SsoSessionContext.Provider value={value}>{children}</SsoSessionContext.Provider>
}

/** 读取 SSO session 上下文；必须在 SsoSessionProvider 内使用 */
export function useSsoSession(): SsoSessionContextValue {
  const ctx = useContext(SsoSessionContext)
  if (!ctx) {
    throw new Error('useSsoSession must be used within SsoSessionProvider')
  }
  return ctx
}
