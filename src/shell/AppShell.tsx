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
 */

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
      <main className="flex-1 min-w-0 h-full flex flex-col bg-surface-2">{content}</main>
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
