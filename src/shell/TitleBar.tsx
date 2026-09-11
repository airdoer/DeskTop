import { useEffect, useState, type ReactNode } from 'react'
import {
  CloseIcon,
  MaximizeIcon,
  MinimizeIcon,
  RestoreIcon,
} from '@/components/ui/icons'
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  subscribeMaximizedChanged,
  toggleMaximizeWindow,
} from '@/services/sso'
import { UserMenu } from './UserMenu'

/*
 * TitleBar — 自定义标题栏（无原生 titleBarOverlay）.
 * 依据 docs/UI_DESIGN_SYSTEM.md §3/§4：Shell 统一提供标题栏。
 *
 * 布局：[拖拽区（占满） … 右侧按钮组：UserMenu | 最小化 | 最大化/还原 | 关闭]
 *   - 整条高度 36px，与 electron/main/index.ts 的 TITLE_BAR_HEIGHT 保持一致
 *   - 左侧至按钮组之间为窗口拖拽区（app-region-drag），双击自动最大化（Chromium 行为）
 *   - 按钮区与按钮均为 app-region-no-drag，确保可点击
 *   - 登录用户按钮位于最小化/最大化/关闭按钮的最左侧（用户要求）
 *
 * 最大化状态由主进程主动推送（window:maximized-changed），切换「最大化/还原」图标。
 * SSO session 由 SsoSessionContext 统一管理，UserMenu 内部直接读取 context，
 *   本组件不再持有 session 本地状态。
 */

/** 与 electron/main/index.ts 的 TITLE_BAR_HEIGHT 保持一致 */
const TITLE_BAR_HEIGHT = 36

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

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
      {/* 拖拽区占满左侧至按钮组 */}
      <div className="flex-1 min-w-0" aria-hidden />

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
