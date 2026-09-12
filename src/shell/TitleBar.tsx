import { useEffect, useState, type ReactNode } from 'react'
import {
  CloseIcon,
  MaximizeIcon,
  MinimizeIcon,
  RestoreIcon,
  SearchIcon,
} from '@/components/ui/icons'
import { Greeting, useGreeting } from '@/features/greeting/Greeting'
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  subscribeMaximizedChanged,
  toggleMaximizeWindow,
} from '@/services/sso'
import { UserMenu } from './UserMenu'
import { useSsoSession } from './ssoSessionContext'

/*
 * TitleBar — 自定义标题栏（无原生 titleBarOverlay）.
 * 依据 docs/UI_DESIGN_SYSTEM.md §3/§4：Shell 统一提供标题栏。
 *
 * 布局：[快捷跳转入口] [拖拽区（问候语右对齐贴住 Persona）…] [按钮组：UserMenu | 最小化 | 最大化/还原 | 关闭]
 *   - 整条高度 36px，与 electron/main/index.ts 的 TITLE_BAR_HEIGHT 保持一致
 *   - 除快捷跳转入口与按钮组外为窗口拖拽区（app-region-drag），双击自动最大化（Chromium 行为）
 *   - 入口与按钮组均为 app-region-no-drag，确保可点击
 *   - 登录用户按钮位于最小化/最大化/关闭按钮的最左侧（用户要求）
 *
 * 快捷跳转入口（§22 Ctrl+K / §23 Command Palette）：常驻显示，不依赖 hover——
 *   仅靠快捷键的功能缺少可发现入口，用户不会知道它存在。窗口收窄到 lg 以下时只留图标。
 *
 * 问候语（docs/GREETING_SPEC.md §3.1）：位于 User Persona 左侧，属被动辅助信息，
 *   不参与拖拽之外的交互——它随拖拽区一起拖动，不是按钮，不进入 Tab 顺序。
 *   仅登录后显示（AC-01 前提为已登录，且 §13 要求与 Persona 同组呈现）。
 *
 * 最大化状态由主进程主动推送（window:maximized-changed），切换「最大化/还原」图标。
 * SSO session 由 SsoSessionContext 统一管理，UserMenu 内部直接读取 context，
 *   本组件不持有 session 本地状态（仅读取登录态用于问候语开关）。
 */

/** 与 electron/main/index.ts 的 TITLE_BAR_HEIGHT 保持一致 */
const TITLE_BAR_HEIGHT = 36

interface TitleBarProps {
  /** 打开快捷跳转浮层（状态由 AppShell 持有） */
  onOpenQuickNav?: () => void
}

export function TitleBar({ onOpenQuickNav }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)
  const { session, loggedIn } = useSsoSession()

  /*
   * 问候语运行时：跨时间边界自动更新，页面切换不重算（GREETING_SPEC §16/§17）。
   * 未登录时 enabled=false → 不渲染，避免「下午好」与红色「登录」按钮并排的语义冲突。
   */
  const greeting = useGreeting({
    enabled: loggedIn,
    username: session?.username ?? undefined,
  })

  // 启动时查询当前最大化状态（订阅推送前先拿一次首帧值）
  useEffect(() => {
    let alive = true
    void isWindowMaximized().then((value) => {
      if (alive) setMaximized(value)
    })
    return () => {
      alive = false
    }
  }, [])

  // 订阅主进程的 maximize/unmaximize 推送
  useEffect(() => {
    return subscribeMaximizedChanged((value) => setMaximized(value))
  }, [])

  return (
    <div
      className="app-region-drag flex items-stretch shrink-0 bg-surface-2 border-b border-border-subtle select-none"
      style={{ height: TITLE_BAR_HEIGHT }}
    >
      {/* 左侧：快捷跳转入口（常驻，保证功能可发现） */}
      <div className="app-region-no-drag flex items-center pl-2">
        <QuickNavTrigger onClick={onOpenQuickNav} />
      </div>

      {/* 拖拽区占满中间；问候语右对齐贴住 Persona */}
      <div className="flex-1 min-w-0 flex items-center justify-end">
        {greeting && (
          /*
           * 响应式（GREETING_SPEC §20）：问候语是「可牺牲信息」，窗口收窄时最先隐藏。
           * 窗口 minWidth=960（electron/main/index.ts），Tailwind 默认 md(768px) 永不生效，
           * 故用 lg(1024px)：默认窗口宽 1200 可见，收窄到 1024 以下让位给 Persona 与窗口按钮。
           */
          <span className="hidden lg:flex items-center min-w-0 pr-3">
            <Greeting message={greeting.text} />
          </span>
        )}
      </div>

      {/* 右侧按钮组：登录用户 | 最小化 | 最大化/还原 | 关闭 */}
      <div className="app-region-no-drag flex items-stretch">
        <UserMenu />
        <WindowButton onClick={() => void minimizeWindow()} title="最小化" ariaLabel="最小化">
          <MinimizeIcon size={11} />
        </WindowButton>
        <WindowButton
          onClick={() => void toggleMaximizeWindow()}
          title={maximized ? '还原' : '最大化'}
          ariaLabel={maximized ? '还原' : '最大化'}
        >
          {maximized ? <RestoreIcon size={11} /> : <MaximizeIcon size={11} />}
        </WindowButton>
        <WindowButton
          onClick={() => void closeWindow()}
          title="关闭"
          ariaLabel="关闭"
          dangerHover
        >
          <CloseIcon size={12} />
        </WindowButton>
      </div>
    </div>
  )
}

/**
 * 快捷跳转入口：常驻的搜索样式按钮，点击等价于 Ctrl+K。
 * 文案在 lg 以下隐藏（窗口 minWidth=960，md 断点永不生效），窄窗时退化为纯图标按钮。
 */
function QuickNavTrigger({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="快捷跳转（Ctrl+K）"
      aria-label="快捷跳转"
      aria-keyshortcuts="Control+K"
      className="flex h-6 items-center gap-1.5 rounded-md border border-border-subtle bg-surface-1 pl-2 pr-1.5 text-foreground-tertiary transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground-secondary"
    >
      <SearchIcon size={13} aria-hidden />
      <span className="hidden lg:inline text-[12px] leading-4">搜索或跳转</span>
      <span className="hidden lg:inline-flex h-4 min-w-[16px] items-center justify-center rounded-sm border border-border bg-surface-3 px-1 text-[10px] font-medium leading-none">
        Ctrl K
      </span>
    </button>
  )
}

interface WindowButtonProps {
  onClick: () => void
  title: string
  ariaLabel: string
  /** 关闭按钮 hover 用红色高亮，对齐 Windows 原生行为 */
  dangerHover?: boolean
  children: ReactNode
}

function WindowButton({ onClick, title, ariaLabel, dangerHover, children }: WindowButtonProps) {
  const hoverClass = dangerHover
    ? 'hover:bg-error hover:text-white active:bg-error'
    : 'hover:bg-surface-hover hover:text-foreground active:bg-surface-3'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`flex items-center justify-center w-[46px] h-full text-foreground-secondary transition-colors ${hoverClass}`}
    >
      {children}
    </button>
  )
}
