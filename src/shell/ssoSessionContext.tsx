import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getSsoSession, startSsoLogin, ssoLogout, type SsoSession } from '@/services/sso'

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
 *   - 内部 loggingIn/loggingOut 用于禁用按钮，避免重复触发
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
  /** 发起 SSO 登录，返回是否成功 */
  login: () => Promise<boolean>
  /** 登出，清除本地 session */
  logout: () => Promise<void>
  /** 重新拉取 session（登录/登出后内部自动调用，也可手动刷新） */
  refresh: () => Promise<void>
}

const SsoSessionContext = createContext<SsoSessionContextValue | null>(null)

export function SsoSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SsoSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

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

  const value: SsoSessionContextValue = {
    session,
    loggedIn: !!session?.username,
    loading,
    loggingIn,
    loggingOut,
    login,
    logout,
    refresh,
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
