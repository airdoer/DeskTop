import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { ToastContainer } from '@/components/feedback/Toast'
import type { RouteId } from './navigation'

/*
 * AppShell — Application Shell.
 * 依据 docs/UI_DESIGN_SYSTEM.md §3/§4：Shell 统一提供 Sidebar、Notification 等，
 *   业务页面禁止自行实现 Shell 组件。Shell 拥有导航状态，pages 只负责渲染内容。
 *
 * 布局：[Sidebar | Main]，Main 渲染当前 active route 对应的 page。
 * ToastContainer 由 Shell 统一挂载（§12.1 统一 Notification Service）。
 *
 * 窗口为无标题栏模式（titleBarStyle: 'hidden' + titleBarOverlay），
 * Main 顶部需留出与浮层等高的区域：既避让原生窗口控制按钮，又作为窗口拖拽区。
 */

/** 与 electron/main/index.ts 的 TITLE_BAR_OVERLAY_HEIGHT 保持一致 */
const TITLE_BAR_HEIGHT = 36

interface AppShellProps {
  pages: Partial<Record<RouteId, ReactNode>>
  defaultRoute?: RouteId
}

export function AppShell({ pages, defaultRoute = 'home' }: AppShellProps) {
  const [active, setActive] = useState<RouteId>(defaultRoute)
  const content = pages[active] ?? <DefaultFallback />

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-2 text-foreground">
      <Sidebar active={active} onNavigate={setActive} />
      <main className="flex-1 min-w-0 h-full flex flex-col bg-surface-2">
        {/* 避让窗口控制按钮浮层，同时作为窗口拖拽区（无标题栏后窗口仍可拖动） */}
        <div
          className="app-region-drag shrink-0"
          style={{ height: TITLE_BAR_HEIGHT }}
          aria-hidden
        />
        <div className="flex-1 min-h-0 flex flex-col">{content}</div>
      </main>
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
