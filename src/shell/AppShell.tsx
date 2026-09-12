import { useCallback, useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TabPane } from './TabPane'
import { TitleBar } from './TitleBar'
import { LoginGate } from './LoginGate'
import { SsoSessionProvider, useSsoSession } from './ssoSessionContext'
import { ToastContainer } from '@/components/feedback/Toast'
import { useStartupUpdateCheck } from '@/features/app-update/useStartupUpdateCheck'
import { QUICK_NAV_ENTRIES, type QuickNavEntry } from '@/features/quick-nav/entries'
import { QuickNavPalette } from '@/features/quick-nav/QuickNavPalette'
import { useQuickNavHotkey } from '@/features/quick-nav/useQuickNavHotkey'
import type { RouteId } from './navigation'
import {
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToLeft,
  closeTabsToRight,
  createInitialTabState,
  cycleActiveTab,
  findActiveTab,
  moveTab,
  navigateInActiveTab,
  openInNewTab,
  reopenLastClosedTab,
  setActiveTab,
  setTabState,
} from './tabs/tabState'
import type { TabManagerState } from './tabs/tabTypes'
import { useReopenClosedTabHotkey } from './tabs/useReopenClosedTabHotkey'
import { useTabCycleHotkey } from './tabs/useTabCycleHotkey'

/*
 * AppShell — Application Shell.
 * 依据 docs/UI_DESIGN_SYSTEM.md §3/§4：Shell 统一提供 Sidebar、Notification 等，
 *   业务页面禁止自行实现 Shell 组件。Shell 拥有导航状态，pages 只负责渲染内容。
 *
 * 布局：[Sidebar | Main]，Main 渲染当前 active tab 对应的 page.
 *   - Main 顶部是 TitleBar（含 TabBar），其下是 QuickNavTrigger（搜索入口），
 *     再下是所有打开过的 tab 的 page（keep-alive）。
 *   - ToastContainer 由 Shell 统一挂载（§12.1 统一 Notification Service）。
 *
 * 多 tab 导航（用户要求，类似 Chrome）：
 *   - Shell 持有 TabManagerState（tabs / activeTabId / closedStack）；
 *   - Sidebar 点击 / QuickNavPalette 选择均通过 onNavigate(routeId, openInNewTab) 触达 Shell；
 *   - 无修饰键 → 在当前 tab 内导航（替换 routeId）；Ctrl/Shift → 开新 tab；
 *   - Ctrl+Shift+T 恢复最近关闭的 tab（含已选元素 state）；
 *   - TabBar 提供切换 / 关闭 / 拖拽重排 / 右键批量关闭。
 *
 * Keep-alive（切 tab 不丢状态）：
 *   - 所有打开过的 tab 的 page 同时挂载，非激活用 `hidden`（display:none）隐藏而非卸载；
 *   - 切换 tab 时 React 不卸载 page，本地 state（已选元素、已加载表格、滚动位置、
 *     输入内容等）全部保留；只有「在当前 tab 内导航到不同路由」或「关闭 tab」时才卸载；
 *   - 每个 tab 独立 TabContextProvider，api 绑定到该 tab 的 state，互不干扰
 *     （见 src/shell/TabPane.tsx）。
 *
 * TabContext（已选元素快照）：
 *   - 当前激活 tab 的 state 通过 TabContext 暴露给页面；
 *   - 页面通过 useTabState<T>() 读取上次保存的状态（恢复语义），
 *     并通过 setTabState 写回（关闭时随 tab 进 closedStack，Ctrl+Shift+T 恢复时还原）。
 *
 * 登录态：SsoSessionProvider 在 Shell 顶层提供，TitleBar / UserMenu / LoginGate /
 *   Redmine 面板等均通过 useSsoSession 读取同一份 session。
 * 未登录拦截：未登录时主区显示 LoginGate，业务页面（含 Redmine/P4 等功能）不可用；
 *   登录成功后自动切换为正常 page 内容。
 *
 * 快捷跳转（Command Palette，§22/§23）：属于 Shell 能力，由本组件持有开关状态并挂载浮层，
 *   业务页面不感知。唤起入口有两个：主内容区顶部的 QuickNavTrigger（可发现性）与全局 Ctrl+K。
 */

interface AppShellProps {
  pages: Partial<Record<RouteId, () => ReactNode>>
  defaultRoute?: RouteId
}

export function AppShell({ pages, defaultRoute = 'home' }: AppShellProps) {
  return (
    <SsoSessionProvider>
      <AppShellContent pages={pages} defaultRoute={defaultRoute} />
    </SsoSessionProvider>
  )
}

function AppShellContent({ pages, defaultRoute = 'home' }: AppShellProps) {
  const [tabManager, setTabManager] = useState<TabManagerState>(() =>
    createInitialTabState(defaultRoute),
  )
  const [quickNavOpen, setQuickNavOpen] = useState(false)
  const { loggedIn, loading } = useSsoSession()

  const activeTab = findActiveTab(tabManager)
  const activeRouteId = activeTab?.routeId ?? defaultRoute

  // Ctrl/⌘+K 开关：已打开时再按一次收起（与参考实现一致）
  const toggleQuickNav = useCallback(() => setQuickNavOpen((open) => !open), [])
  const openQuickNav = useCallback(() => setQuickNavOpen(true), [])
  const closeQuickNav = useCallback(() => setQuickNavOpen(false), [])

  /**
   * 导航入口：Sidebar 点击 / QuickNavPalette 选择均走这里.
   * @param routeId 目标路由
   * @param newTab true=开新 tab；false=在当前 tab 内导航
   */
  const handleNavigate = useCallback(
    (routeId: RouteId, newTab: boolean) => {
      setTabManager((prev) =>
        newTab ? openInNewTab(prev, routeId) : navigateInActiveTab(prev, routeId),
      )
    },
    [],
  )

  const handleQuickNavSelect = useCallback(
    (entry: QuickNavEntry, newTab: boolean) => {
      handleNavigate(entry.id, newTab)
    },
    [handleNavigate],
  )

  // ---- Tab 操作回调（都通过 setTabManager 走纯函数更新） ----
  const handleSelectTab = useCallback((tabId: string) => {
    setTabManager((prev) => setActiveTab(prev, tabId))
  }, [])
  const handleCloseTab = useCallback((tabId: string) => {
    setTabManager((prev) => closeTab(prev, tabId, 'home'))
  }, [])
  const handleReorderTabs = useCallback((from: number, to: number) => {
    setTabManager((prev) => moveTab(prev, from, to))
  }, [])
  const handleCloseLeftTabs = useCallback((tabId: string) => {
    setTabManager((prev) => closeTabsToLeft(prev, tabId, 'home'))
  }, [])
  const handleCloseRightTabs = useCallback((tabId: string) => {
    setTabManager((prev) => closeTabsToRight(prev, tabId, 'home'))
  }, [])
  const handleCloseOtherTabs = useCallback((tabId: string) => {
    setTabManager((prev) => closeOtherTabs(prev, tabId, 'home'))
  }, [])
  const handleCloseAllTabs = useCallback(() => {
    setTabManager((prev) => closeAllTabs(prev, 'home'))
  }, [])
  const handleReopenClosedTab = useCallback(() => {
    setTabManager((prev) => reopenLastClosedTab(prev))
  }, [])
  /** 循环切换 tab：滚轮 / Ctrl+Tab / Ctrl+Shift+Tab 都走这里，step >0 向右、<0 向左（wrap-around） */
  const handleCycleTab = useCallback((step: number) => {
    setTabManager((prev) => cycleActiveTab(prev, step))
  }, [])
  /** 页面经 TabContext 调用：写入指定 tab 的 state（关闭时随 tab 进 closedStack） */
  const handleSetTabState = useCallback((tabId: string, state: unknown) => {
    setTabManager((prev) => setTabState(prev, tabId, state))
  }, [])

  useQuickNavHotkey(toggleQuickNav)
  useReopenClosedTabHotkey(handleReopenClosedTab)
  useTabCycleHotkey(handleCycleTab)

  // 登录后延迟静默检查更新（仅安装版生效）；LoginGate 期间不打扰用户
  useStartupUpdateCheck(!loading && loggedIn)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-2 text-foreground">
      <Sidebar active={activeRouteId} onNavigate={handleNavigate} onOpenQuickNav={openQuickNav} />
      <main className="flex-1 min-w-0 h-full flex flex-col bg-surface-2">
        {/* 标题栏：TabBar + 拖拽区 + 登录用户按钮 + 最小化/最大化/关闭 */}
        <TitleBar
          tabs={tabManager.tabs}
          activeTabId={tabManager.activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onReorderTabs={handleReorderTabs}
          onCloseLeftTabs={handleCloseLeftTabs}
          onCloseRightTabs={handleCloseRightTabs}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseAllTabs={handleCloseAllTabs}
          onCycleTab={handleCycleTab}
        />
        <div className="flex-1 min-h-0 flex flex-col">
          {loading ? (
            <LoadingScreen />
          ) : loggedIn ? (
            <>
              {/*
                Keep-alive 多 tab：所有打开过的 tab 的 page 同时挂载，非激活用 hidden 隐藏。
                切换 tab 时 React 不卸载 page，本地 state（已选元素、已加载表格、滚动位置、
                输入内容等）全部保留；只有「在当前 tab 内导航到不同路由」或「关闭 tab」时
                对应 page 才卸载。每个 tab 独立 TabContextProvider，api 绑定到该 tab 的 state。
              */}
              <div className="flex-1 min-h-0 flex flex-col">
                {tabManager.tabs.map((tab) => (
                  <TabPane
                    key={tab.id}
                    tab={tab}
                    active={tab.id === tabManager.activeTabId}
                    render={pages[tab.routeId]}
                    onSetTabState={handleSetTabState}
                  />
                ))}
              </div>
            </>
          ) : (
            <LoginGate />
          )}
        </div>
      </main>
      <QuickNavPalette
        open={quickNavOpen}
        entries={QUICK_NAV_ENTRIES}
        onClose={closeQuickNav}
        onSelect={handleQuickNavSelect}
      />
      <ToastContainer />
    </div>
  )
}

/** 首次加载 session 时的过渡屏（避免 LoginGate 闪烁） */
function LoadingScreen() {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-foreground-tertiary">
      加载中…
    </div>
  )
}
