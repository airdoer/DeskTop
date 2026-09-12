import { useEffect, useState, type ReactNode } from 'react'
import {
  CloseIcon,
  MaximizeIcon,
  MinimizeIcon,
  RestoreIcon,
} from '@/components/ui/icons'
import { Greeting, useGreeting } from '@/features/greeting/Greeting'
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  subscribeMaximizedChanged,
  toggleMaximizeWindow,
} from '@/services/sso'
import { TabBar } from './TabBar'
import { UserMenu } from './UserMenu'
import { useSsoSession } from './ssoSessionContext'
import type { Tab } from './tabs/tabTypes'

/*
 * TitleBar — 自定义标题栏（无原生 titleBarOverlay）.
 * 依据 docs/UI_DESIGN_SYSTEM.md §3/§4：Shell 统一提供标题栏。
 *
 * 布局（与 Chrome 类似，标签栏嵌入标题栏）：
 *   [TabBar … 拖拽区（问候语右对齐贴住 Persona）…] [按钮组：UserMenu | 最小化 | 最大化/还原 | 关闭]
 *   - 整条高度 36px，与 electron/main/index.ts 的 TITLE_BAR_HEIGHT 保持一致
 *   - TabBar 与按钮组为 app-region-no-drag，确保可点击；其余为窗口拖拽区
 *   - TabBar 的空白处（标签之间或末尾）由 TabBar 内部 app-region-drag 接管窗口拖拽
 *   - 登录用户按钮位于最小化/最大化/关闭按钮的最左侧（用户要求）
 *
 * 布局修复（2026-09）：TabBar 用 flex-1 独占剩余空间，问候语区 shrink-0 按内容宽度，
 *   避免「TabBar 与问候语区各 flex-1 平分」导致 TabBar 中段截断、右侧空白的 bug.
 *
 * 多 tab 退让（用户要求）：tab 增多导致横向空间紧张时，按「可牺牲性」依次让出：
 *   1. 问候语最先让出（被动辅助信息，GREETING_SPEC §20 已规定它是可牺牲项）；
 *   2. 其次让出 UserMenu 的「图标 + 用户名」，只留绿色状态圆点；
 *   3. 最后连圆点也让出，把全部空间给 TabBar。
 * 阈值用 tab 数量而非窗口宽度：tab 数量是「用户能直观看到有几条」的直接因果，
 *   而窗口宽度需额外 ResizeObserver，且用户拉伸窗口时 tab 宽度本就会变（overflow-x-auto 兜底）。
 */

/** 与 electron/main/index.ts 的 TITLE_BAR_HEIGHT 保持一致 */
const TITLE_BAR_HEIGHT = 36

/*
 * 退让阈值：tab 数量到达几条时依次隐藏问候语 / UserMenu 主体 / 状态圆点.
 * 阈值取值依据：默认窗口宽 1200，TabBar 每个 tab min-w-[120px]，
 *   - 6 条 tab ≈ 720px，加按钮组约 200px + UserMenu 完整 160px ≈ 1080，问候语挤不下 → 隐问候语；
 *   - 9 条 tab ≈ 1080px，加按钮组 + UserMenu 完整 ≈ 1440 > 1200 → UserMenu 只留圆点（省 ~120px）；
 *   - 12 条 tab ≈ 1440px，连圆点都挤掉，TabBar 拿满 1200 - 200(按钮组) ≈ 1000 仍需横向滚动.
 * 实际有 overflow-x-auto 兜底，阈值只控制「何时让出辅助元素」，不影响 tab 可达性.
 */
const GREETING_HIDE_THRESHOLD = 6
const USERMENU_COMPACT_THRESHOLD = 9
const USERMENU_HIDE_THRESHOLD = 12

interface TitleBarProps {
  /** Tab 列表（由 AppShell 持有，TitleBar 只渲染 + 回调） */
  tabs: Tab[]
  activeTabId: string
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onReorderTabs: (from: number, to: number) => void
  onCloseLeftTabs: (tabId: string) => void
  onCloseRightTabs: (tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseAllTabs: () => void
  /** 循环切换激活 tab（滚轮 / Ctrl+Tab），step > 0 向右、< 0 向左 */
  onCycleTab: (step: number) => void
}

export function TitleBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  onCloseLeftTabs,
  onCloseRightTabs,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCycleTab,
}: TitleBarProps) {
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

  // 多 tab 退让：根据 tab 数量决定各辅助元素的可见性
  const tabCount = tabs.length
  const showGreeting = tabCount < GREETING_HIDE_THRESHOLD
  const userMenuMode: 'full' | 'compact' | 'hidden' =
    tabCount >= USERMENU_HIDE_THRESHOLD
      ? 'hidden'
      : tabCount >= USERMENU_COMPACT_THRESHOLD
        ? 'compact'
        : 'full'

  return (
    <div
      className="app-region-drag flex items-stretch shrink-0 bg-surface-2 border-b border-border-subtle select-none"
      style={{ height: TITLE_BAR_HEIGHT }}
    >
      {/* 左侧：TabBar（独占剩余空间，内部 overflow-x-auto 兜底横向滚动） */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={onSelectTab}
        onClose={onCloseTab}
        onReorder={onReorderTabs}
        onCloseLeft={onCloseLeftTabs}
        onCloseRight={onCloseRightTabs}
        onCloseOthers={onCloseOtherTabs}
        onCloseAll={onCloseAllTabs}
        onCycle={onCycleTab}
      />

      {/* 拖拽区：按内容宽度，被 TabBar 挤到右边；仅在有问候语时占位 */}
      {showGreeting && greeting && (
        <div className="flex items-center justify-end shrink-0">
          <span className="hidden lg:flex items-center min-w-0 pr-3">
            <Greeting message={greeting.text} />
          </span>
        </div>
      )}

      {/* 右侧按钮组：登录用户 | 最小化 | 最大化/还原 | 关闭 */}
      <div className="app-region-no-drag flex items-stretch">
        {userMenuMode !== 'hidden' && <UserMenu mode={userMenuMode} />}
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
