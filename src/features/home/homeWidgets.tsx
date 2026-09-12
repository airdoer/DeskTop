import type { ReactNode } from 'react'
import { NAV_ITEMS, collectNavLeaves, type NavLeafEntry, type RouteId } from '@/shell/navigation'
import { SystemInfoPanel } from '@/features/system-info/SystemInfoPanel'
import { QuickDirectoriesPanel } from '@/features/quick-directories/QuickDirectoriesPanel'
import { P4WorkspacesPanel } from '@/features/p4-workspaces/P4WorkspacesPanel'
import { RedmineIssuesPanel } from '@/features/redmine-issues/RedmineIssuesPanel'
import { WebsitesPanel } from '@/features/websites/WebsitesPanel'
import { P4MergePanel } from '@/features/p4-merge/P4MergePanel'
import { PathConvertPanel } from '@/features/p4-paths/PathConvertPanel'

/*
 * 主页组件注册表 —— 「可拼装主页」的唯一数据源.
 *
 * 依据用户要求：主页由用户自行组合，可添加 / 删除 / 拖动排序。
 * 可拼装的组件 = 除「主页」与「设置」之外的全部功能页签，
 *   即 id 与 RouteId 完全一致：这样「主页里能拼的组件」与「侧边栏能进的页签」永远同集合，
 *   新增一个功能页签时会自动出现在「添加组件」菜单里（由 test/home-layout.test.ts 强制覆盖）。
 *
 * 本文件只负责「id → 渲染哪个面板」这一件导航层无法知道的事；
 *   标题 / 图标 / 识别色一律从 navigation.ts 取（collectNavLeaves），不在此重复声明，
 *   否则「添加组件」菜单里的名字与图标会和侧边栏漂移。
 *
 * 注意：布局（顺序/取舍）由 services/homeLayout.ts 管理并持久化，本文件不参与。
 */

/** 可作为主页组件的页签：除主页自身与设置之外的全部功能页 */
export type HomeWidgetId = Exclude<RouteId, 'home' | 'settings'>

export interface HomeWidget extends NavLeafEntry {
  id: HomeWidgetId
  /** 渲染组件本体。面板自带标题/操作，主页只负责外层排布与编辑态装饰 */
  render: () => ReactNode
}

/*
 * id → 面板渲染器。用 Record<HomeWidgetId, ...> 声明：
 *   新增一个路由却忘了注册渲染器会在编译期直接报错，而不是运行时静默少一块。
 */
const WIDGET_RENDERERS: Record<HomeWidgetId, () => ReactNode> = {
  'system-info': () => <SystemInfoPanel />,
  'quick-dirs': () => <QuickDirectoriesPanel />,
  'p4-workspaces': () => <P4WorkspacesPanel />,
  redmine: () => <RedmineIssuesPanel />,
  websites: () => <WebsitesPanel />,
  'p4-merge': () => <P4MergePanel />,
  'p4-path': () => <PathConvertPanel />,
}

function isHomeWidgetId(id: RouteId): id is HomeWidgetId {
  return id !== 'home' && id !== 'settings'
}

/** 顺序沿用侧边栏声明顺序，使「添加组件」菜单的排序与侧边栏一致 */
export const HOME_WIDGETS: HomeWidget[] = collectNavLeaves(NAV_ITEMS)
  .filter((leaf): leaf is NavLeafEntry & { id: HomeWidgetId } => isHomeWidgetId(leaf.id))
  .map((leaf) => ({ ...leaf, render: WIDGET_RENDERERS[leaf.id] }))

export const HOME_WIDGET_IDS: HomeWidgetId[] = HOME_WIDGETS.map((widget) => widget.id)

/**
 * 默认布局：与改造前的主页内容一致（4 个本机资源面板，单列纵排）。
 * 保证老用户升级后打开主页看到的仍是原来的内容，只是多了一份可编辑能力。
 */
export const DEFAULT_HOME_LAYOUT: HomeWidgetId[] = [
  'system-info',
  'quick-dirs',
  'p4-workspaces',
  'redmine',
]

export function findHomeWidget(id: string): HomeWidget | undefined {
  return HOME_WIDGETS.find((widget) => widget.id === id)
}
