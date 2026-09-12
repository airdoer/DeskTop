import { useCallback, useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import { LoginGate } from './LoginGate'
import { SsoSessionProvider, useSsoSession } from './ssoSessionContext'
import { ToastContainer } from '@/components/feedback/Toast'
import { useStartupUpdateCheck } from '@/features/app-update/useStartupUpdateCheck'
import { QUICK_NAV_ENTRIES, type QuickNavEntry } from '@/features/quick-nav/entries'
import { QuickNavPalette } from '@/features/quick-nav/QuickNavPalette'
import { useQuickNavHotkey } from '@/features/quick-nav/useQuickNavHotkey'
import type { RouteId } from './navigation'

/*
 * AppShell — Application Shell.
 * 依据 docs/UI_DESIGN_SYSTEM.md §3/§4：Shell 统一提供 Sidebar、Notification 等，
 *   业务页面禁止自行实现 Shell 组件。Shell 拥有导航状态，pages 只负责渲染内容。
 *
 * 布局：[Sidebar | Main]，Main 渲染当前 active route 对应的 page。
 * ToastContainer 由 Shell 统一挂载（§12.1 统一 Notification Service）。
 *
 * 登录态：SsoSessionProvider 在 Shell 顶层提供，TitleBar / UserMenu / LoginGate /
 *   Redmine 面板等均通过 useSsoSession 读取同一份 session。
 * 未登录拦截：未登录时主区显示 LoginGate，业务页面（含 Redmine/P4 等功能）不可用；
 *   登录成功后自动切换为正常 page 内容。
 *
 * 窗口为无标题栏模式（titleBarStyle: 'hidden'，不使用 titleBarOverlay），
 * Main 顶部用 TitleBar 组件承载拖拽区 + 自定义窗口控制按钮 + 登录用户按钮，
 * 高度 36px（与 electron/main/index.ts 的 TITLE_BAR_HEIGHT 保持一致）。
 *
 * 快捷跳转（Command Palette，§22/§23）：属于 Shell 能力，由本组件持有开关状态并挂载浮层，
 *   业务页面不感知。唤起入口有两个：TitleBar 的常驻按钮（可发现性）与全局 Ctrl+K。
 */

interface AppShellProps {
  pages: Partial<Record<RouteId, ReactNode>>
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
  const [active, setActive] = useState<RouteId>(defaultRoute)
  const [quickNavOpen, setQuickNavOpen] = useState(false)
  const { loggedIn, loading } = useSsoSession()
  const pageContent = pages[active] ?? <DefaultFallback />

  // Ctrl/⌘+K 开关：已打开时再按一次收起（与参考实现一致）
  const toggleQuickNav = useCallback(() => setQuickNavOpen((open) => !open), [])
  const openQuickNav = useCallback(() => setQuickNavOpen(true), [])
  const closeQuickNav = useCallback(() => setQuickNavOpen(false), [])

  const handleQuickNavSelect = useCallback((entry: QuickNavEntry) => {
    setActive(entry.id)
  }, [])

  useQuickNavHotkey(toggleQuickNav)

  // 登录后延迟静默检查更新（仅安装版生效）；LoginGate 期间不打扰用户
  useStartupUpdateCheck(!loading && loggedIn)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-2 text-foreground">
      <Sidebar active={active} onNavigate={setActive} />
      <main className="flex-1 min-w-0 h-full flex flex-col bg-surface-2">
        {/* 标题栏：拖拽区 + 登录用户按钮 + 最小化/最大化/关闭（自定义，无原生浮层） */}
        <TitleBar onOpenQuickNav={openQuickNav} />
        <div className="flex-1 min-h-0 flex flex-col">
          {loading ? (
            <LoadingScreen />
          ) : loggedIn ? (
            pageContent
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

function DefaultFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-foreground-tertiary">
      页面未配置
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
