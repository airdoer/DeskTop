import type { ReactNode } from 'react'
import { AppShell } from '@/shell/AppShell'
import type { RouteId } from '@/shell/navigation'
import { HomePage } from '@/pages/HomePage'
import { SystemInfoPage } from '@/pages/SystemInfoPage'
import { QuickDirsPage } from '@/pages/QuickDirsPage'
import { P4WorkspacesPage } from '@/pages/P4WorkspacesPage'
import { RedminePage } from '@/pages/RedminePage'
import { WebsitesPage } from '@/pages/WebsitesPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { P4MergePage } from '@/pages/p4/P4MergePage'
import { P4PathPage } from '@/pages/p4/P4PathPage'

/*
 * App — 渲染 Application Shell 与各 Page 的路由映射.
 * 依据 docs/UI_DESIGN_SYSTEM.md §3/§4：Shell 由 AppShell 统一提供，
 *   业务页面通过 pages map 注入，不感知 Shell 实现。
 *
 * 路由与侧边栏页签一一对应（见 src/shell/navigation.ts）：
 *   主页 + 7 个平级功能页签 + 设置（设置入口固定在侧边栏底部，不是页签）。
 *
 * pages 是「渲染函数」而非「ReactNode」：多 tab 导航下，两个 tab 可能指向同一
 *   路由（如两个 home tab），若值是 ReactNode，它们会共享同一组件实例（state 串）。
 *   改成函数后，每个 tab 调用一次得到独立元素，配合 TabPane 的 key=tab.id，
 *   React 视为两个独立实例，state 互不干扰（见 src/shell/TabPane.tsx）。
 */

const pages: Partial<Record<RouteId, () => ReactNode>> = {
  home: () => <HomePage />,
  'system-info': () => <SystemInfoPage />,
  'quick-dirs': () => <QuickDirsPage />,
  'p4-workspaces': () => <P4WorkspacesPage />,
  redmine: () => <RedminePage />,
  websites: () => <WebsitesPage />,
  'p4-merge': () => <P4MergePage />,
  'p4-path': () => <P4PathPage />,
  settings: () => <SettingsPage />,
}

function App() {
  return <AppShell pages={pages} defaultRoute="home" />
}

export default App
