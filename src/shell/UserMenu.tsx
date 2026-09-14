import { useCallback, useEffect, useRef, useState } from 'react'
import { LogoutIcon, UserIcon } from '@/components/ui/icons'
import { toast } from '@/components/feedback/Toast'
import { useSsoSession } from './ssoSessionContext'

/*
 * UserMenu — 标题栏「登录用户」按钮 + 下拉菜单.
 * 位于自定义窗口控制按钮（最小化/最大化/关闭）的最左侧，与三个窗口按钮同一行、同一高度（36px）。
 *
 * 状态颜色（用户要求）：
 *   - 未登录：按钮左侧显示红色圆点 + 红色「登录」文案，点击发起 SSO 登录
 *   - 已登录：按钮左侧显示绿色圆点 + 用户名，点击展开下拉菜单（登录时间 + 登出）
 *   - 登录中：按钮禁用，文案显示「登录中…」，圆点保持当前状态颜色
 *
 * session / login / logout 由 SsoSessionContext 统一提供，本组件不再持有 session 本地状态。
 * SSO 登录流程详见 electron/main/sso.ts：渲染层调 sso Service → 主进程弹子窗口加载 SSO
 *   登录页 → 拦截重定向拿 ticket → 调 /cas/serviceValidate 校验 → 持久化 session。
 *
 * mode（多 tab 退让，由 TitleBar 根据 tab 数量传入）：
 *   - 'full'：圆点 + 用户图标 + 用户名（默认，tab 少时）
 *   - 'compact'：仅圆点（tab 多到挤压时，让出图标与用户名给 TabBar）
 *   compact 下仍可点击展开下拉菜单，功能不丢，只是首屏只看到一个状态点.
 *
 * 内边距是**左右不对称**的（pl-3 / pr-1.5）：左侧要留出与标签栏的呼吸感，
 * 右侧紧邻置顶按钮，收紧到 6px 才能让「用户名 → 图钉」的间距不至于过空（用户要求）。
 */

type UserMenuMode = 'full' | 'compact'

interface UserMenuProps {
  mode?: UserMenuMode
}

export function UserMenu({ mode = 'full' }: UserMenuProps) {
  const { session, loggedIn, login, logout, loggingIn, loggingOut } = useSsoSession()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const compact = mode === 'compact'

  // 点击外部关闭下拉菜单
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // ESC 关闭菜单
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const handleLogin = useCallback(async () => {
    if (loggingIn) return
    setOpen(false)
    const ok = await login()
    if (ok) {
      // 用户名在 context 内已刷新，UserMenu 重渲染后会显示
      toast.success('登录成功')
    } else {
      // 失败原因：startSsoLogin 失败/取消。用户主动取消不报错，真正失败给通用提示
      toast.error('登录失败，请重试')
    }
  }, [login, loggingIn])

  const handleLogout = useCallback(async () => {
    if (loggingOut) return
    try {
      await logout()
      toast.info('已登出')
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '登出失败')
    }
  }, [logout, loggingOut])

  // 圆点颜色：未登录红、已登录绿
  const dotColor = loggedIn ? 'bg-success' : 'bg-error'
  const dotTitle = loggedIn ? '已登录' : '未登录'

  return (
    <div ref={containerRef} className="relative flex items-stretch h-full">
      <button
        type="button"
        onClick={loggedIn ? () => setOpen((v) => !v) : handleLogin}
        disabled={loggingIn}
        className={`app-region-no-drag flex items-center gap-1.5 h-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-hover ${
          compact ? 'pl-2 pr-1.5' : 'pl-3 pr-1.5 text-[12px] leading-none'
        } ${loggedIn ? 'text-foreground-secondary hover:text-foreground' : 'text-error hover:text-error'}`}
        title={loggedIn ? session?.username ?? '已登录' : '未登录，点击登录'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={loggedIn ? `当前用户：${session?.username ?? ''}` : '未登录，点击登录'}
      >
        {/* 状态圆点：未登录红、已登录绿（compact 模式下唯一可见元素） */}
        <span
          className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`}
          title={dotTitle}
          aria-hidden
        />
        {!compact && (
          <>
            <UserIcon size={14} />
            <span className="truncate max-w-[120px]">
              {loggingIn ? '登录中…' : loggedIn ? (session?.username ?? '') : '登录'}
            </span>
          </>
        )}
      </button>

      {loggedIn && open && (
        <div
          role="menu"
          className="app-region-no-drag absolute top-full right-0 mt-0.5 min-w-[200px] rounded-md border border-border bg-surface-1 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.15)] z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-success" aria-hidden />
              <span className="text-[13px] font-medium text-foreground truncate">
                {session?.username ?? ''}
              </span>
            </div>
            <div className="text-[11px] text-foreground-tertiary truncate pl-3.5">
              {formatLoginTime(session?.loginAt ?? '')}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-2 w-full h-9 px-3 text-[13px] text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            <LogoutIcon size={14} />
            <span>{loggingOut ? '登出中…' : '登出'}</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** 格式化登录时间：ISO → "MM-DD HH:mm" 简短显示 */
function formatLoginTime(iso: string): string {
  if (!iso) return '已登录'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '已登录'
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi} 登录`
}
