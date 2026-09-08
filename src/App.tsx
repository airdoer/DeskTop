import type { ReactNode } from 'react'
import { AppShell } from '@/shell/AppShell'
import type { RouteId } from '@/shell/navigation'
import { HomePage } from '@/pages/HomePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { P4UpdatePage } from '@/pages/p4/P4UpdatePage'
import { P4MergePage } from '@/pages/p4/P4MergePage'

/*
 * App — 渲染 Application Shell 与各 Page 的路由映射.
 * 依据 docs/UI_DESIGN_SYSTEM.md §3/§4：Shell 由 AppShell 统一提供，
 *   业务页面通过 pages map 注入，不感知 Shell 实现。
 */

const pages: Partial<Record<RouteId, ReactNode>> = {
  home: <HomePage />,
  settings: <SettingsPage />,
  'p4-update': <P4UpdatePage />,
  'p4-merge': <P4MergePage />,
}

function App() {
  return <AppShell pages={pages} defaultRoute="home" />
}

export default App
