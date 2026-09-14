import { useCallback, useEffect, useRef, useState } from 'react'
import { AppButton } from '@/components/ui/AppButton'
import { AppInput } from '@/components/ui/AppInput'
import { LogoutIcon, SwapIcon, UserIcon } from '@/components/ui/icons'
import { toast } from '@/components/feedback/Toast'
import { useSsoSession } from './ssoSessionContext'

/*
 * UserMenu — 标题栏「登录用户」按钮 + 下拉菜单.
 * 位于自定义窗口控制按钮（最小化/最大化/关闭）的最左侧，与三个窗口按钮同一行、同一高度（36px）。
 *
 * 状态颜色（用户要求）：
 *   - 未登录：按钮左侧显示红色圆点 + 红色「登录」文案，点击发起 SSO 登录
 *   - 已登录：按钮左侧显示绿色圆点 + 用户名，点击展开下拉菜单（登录时间 + 登出）
 *   - 调试身份：圆点变橙色（warning），title 点明真实用户是谁（见下）
 *   - 登录中：按钮禁用，文案显示「登录中…」，圆点保持当前状态颜色
 *
 * session / login / logout / impersonate 由 SsoSessionContext 统一提供，本组件不再持有 session 本地状态。
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
 *
 * 调试身份（自测用，入口在下拉菜单内）：
 *   为了自测「其他用户能看到什么」（如某人的 Redmine 单子），允许把当前身份临时切成另一个
 *   Redmine 用户。覆盖值只存在于主进程内存、不落盘，**重启应用即恢复真实身份**；
 *   切换前会校验该登录名在 Redmine 确实存在，避免切到一个拼错的名字后对着空列表发懵。
 *   入口只对 DEBUG_IDENTITY_OWNER 可见，避免分发给其他同事后被误当成正式功能。
 */

type UserMenuMode = 'full' | 'compact'

/** 下拉菜单的两种视图：常规菜单 / 切换调试身份的输入区 */
type MenuView = 'menu' | 'switch'

/*
 * 调试身份的**唯一**白名单持有者.
 * 判定依据是「真实登录用户」而非当前有效用户：一旦切成了别人，还要能靠它继续操作（切回或再切）。
 * 这里硬编码是刻意的——它不是「用户身份的默认值回退」（那种写法会导致静默查到别人的数据），
 * 而是一个调试开关的持有者判定，语义完全不同。将来要换成环境变量或配置项，只改这一行。
 * 值必须小写（比较时两边都 toLowerCase）。
 */
const DEBUG_IDENTITY_OWNER = 'chenzhixu'

interface UserMenuProps {
  mode?: UserMenuMode
}

export function UserMenu({ mode = 'full' }: UserMenuProps) {
  const {
    session,
    loggedIn,
    login,
    logout,
    loggingIn,
    loggingOut,
    impersonating,
    impersonate,
  } = useSsoSession()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<MenuView>('menu')
  const [loginInput, setLoginInput] = useState('')
  const [switchError, setSwitchError] = useState<string>()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const compact = mode === 'compact'

  const impersonated = session?.impersonated === true
  const realUsername = session?.realUsername || session?.username || ''
  /*
   * 只有真实登录者是白名单持有者时才暴露调试入口.
   * 比较时统一小写：SSO 返回的是邮箱前缀（约定小写），但不值得为大小写差异把入口藏掉。
   */
  const canDebugIdentity = loggedIn && realUsername.toLowerCase() === DEBUG_IDENTITY_OWNER

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

  // 菜单关闭时复位视图与输入，避免下次打开残留上一次的报错文案
  useEffect(() => {
    if (open) return
    setView('menu')
    setLoginInput('')
    setSwitchError(undefined)
  }, [open])

  // 进入切换视图后自动聚焦输入框（键盘操作不必再点一次）
  useEffect(() => {
    if (open && view === 'switch') inputRef.current?.focus()
  }, [open, view])

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

  const handleImpersonate = useCallback(async () => {
    if (impersonating) return
    const target = loginInput.trim()
    if (!target) {
      setSwitchError('请输入登录名（邮箱前缀，如 chenzhixu）')
      return
    }
    const result = await impersonate(target)
    if (result.ok) {
      toast.warning(`已切换为 ${target}（调试身份）`)
      setOpen(false)
    } else {
      // 校验失败原因（查无此人 / 网络 / 权限）直接落在菜单内，不弹 Toast：
      // 用户要照着错误改输入框里的名字，Toast 2 秒就消失，改起来还得重输
      setSwitchError(result.error ?? '切换失败')
    }
  }, [impersonate, impersonating, loginInput])

  const handleRestore = useCallback(async () => {
    if (impersonating) return
    const result = await impersonate(null)
    if (result.ok) {
      toast.info('已恢复真实身份')
      setOpen(false)
    } else {
      setSwitchError(result.error ?? '恢复失败')
    }
  }, [impersonate, impersonating])

  // 圆点颜色：未登录红、已登录绿、调试身份橙（必须一眼看出当前不是真实身份）
  const dotColor = impersonated ? 'bg-warning' : loggedIn ? 'bg-success' : 'bg-error'
  const dotTitle = impersonated ? '调试身份（非真实登录）' : loggedIn ? '已登录' : '未登录'

  const buttonTitle = impersonated
    ? `调试身份：${session?.username ?? ''}（真实用户：${realUsername}）`
    : loggedIn
      ? (session?.username ?? '已登录')
      : '未登录，点击登录'

  return (
    <div ref={containerRef} className="relative flex items-stretch h-full">
      <button
        type="button"
        onClick={loggedIn ? () => setOpen((v) => !v) : handleLogin}
        disabled={loggingIn}
        className={`app-region-no-drag flex items-center gap-1.5 h-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-hover ${
          compact ? 'pl-2 pr-1.5' : 'pl-3 pr-1.5 text-[12px] leading-none'
        } ${
          loggedIn
            ? impersonated
              ? 'text-warning hover:text-warning'
              : 'text-foreground-secondary hover:text-foreground'
            : 'text-error hover:text-error'
        }`}
        title={buttonTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={loggedIn ? `当前用户：${session?.username ?? ''}` : '未登录，点击登录'}
      >
        {/* 状态圆点：未登录红、已登录绿、调试身份橙（compact 模式下唯一可见元素） */}
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
          className={`app-region-no-drag absolute top-full right-0 mt-0.5 rounded-md border border-border bg-surface-1 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.15)] z-50 overflow-hidden ${
            view === 'switch' ? 'w-[296px]' : 'min-w-[200px]'
          }`}
        >
          {view === 'menu' ? (
            <>
              <div className="px-3 py-2 border-b border-border-subtle">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`}
                    aria-hidden
                  />
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {session?.username ?? ''}
                  </span>
                </div>
                <div className="text-[11px] text-foreground-tertiary truncate pl-3.5">
                  {formatLoginTime(session?.loginAt ?? '')}
                </div>
                {impersonated && (
                  <div className="mt-1 ml-3.5 text-[11px] text-warning leading-4">
                    调试身份 · 真实用户 {realUsername}
                  </div>
                )}
              </div>

              {canDebugIdentity && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setView('switch')}
                  className="flex items-center gap-2 w-full h-9 px-3 text-[13px] text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground border-b border-border-subtle"
                >
                  <SwapIcon size={14} />
                  <span className="flex-1 text-left">切换用户（调试）</span>
                </button>
              )}

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
            </>
          ) : (
            <div className="p-3 flex flex-col gap-2">
              <div className="text-[13px] font-medium text-foreground">以其他用户身份运行</div>

              <div className="flex items-center gap-2">
                <AppInput
                  ref={inputRef}
                  value={loginInput}
                  onChange={(e) => {
                    setLoginInput(e.target.value)
                    if (switchError) setSwitchError(undefined)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    // 中文输入法确认候选词时同样触发 Enter，必须跳过，否则会误提交
                    if (e.nativeEvent.isComposing) return
                    void handleImpersonate()
                  }}
                  invalid={!!switchError}
                  placeholder="登录名，如 hantao03"
                  aria-label="要切换到的登录名"
                  spellCheck={false}
                  autoComplete="off"
                />
                <AppButton
                  size="sm"
                  variant="primary"
                  loading={impersonating}
                  onClick={() => void handleImpersonate()}
                  className="shrink-0"
                >
                  切换
                </AppButton>
              </div>

              {switchError && (
                <div className="text-[11px] text-error leading-4 break-all">{switchError}</div>
              )}

              <div className="text-[11px] text-foreground-tertiary leading-4">
                切换前会校验该登录名在 Redmine 是否存在。生效范围是本工具内所有取当前身份的功能
                （Redmine 单子、P4V 打开用户等）；<span className="text-foreground-secondary">不改动真实登录态，重启应用即恢复</span>。
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                {impersonated && (
                  <AppButton
                    size="sm"
                    variant="default"
                    loading={impersonating}
                    onClick={() => void handleRestore()}
                  >
                    恢复真实身份
                  </AppButton>
                )}
                <AppButton
                  size="sm"
                  variant="ghost"
                  onClick={() => setView('menu')}
                  className="ml-auto"
                >
                  返回
                </AppButton>
              </div>
            </div>
          )}
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
