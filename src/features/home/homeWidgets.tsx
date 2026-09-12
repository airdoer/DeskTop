import type { ComponentType, ReactNode } from 'react'
import {
  BranchIcon,
  FolderIcon,
  GlobeIcon,
  MergeIcon,
  MonitorIcon,
  SwapIcon,
  TicketIcon,
  type IconProps,
} from '@/components/ui/icons'
import type { RouteId } from '@/shell/navigation'
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
 * 注意：本文件只描述「有哪些组件」，布局（顺序/取舍）由 services/homeLayout.ts 管理并持久化。
 */

/** 可作为主页组件的页签：除主页自身与设置之外的全部功能页 */
export type HomeWidgetId = Exclude<RouteId, 'home' | 'settings'>

export interface HomeWidget {
  id: HomeWidgetId
  label: string
  icon: ComponentType<IconProps>
  /** 渲染组件本体。面板自带标题/操作，主页只负责外层排布与编辑态装饰 */
  render: () => ReactNode
}

export const HOME_WIDGETS: HomeWidget[] = [
  {
    id: 'system-info',
    label: '系统信息',
    icon: MonitorIcon,
    render: () => <SystemInfoPanel />,
  },
  {
    id: 'quick-dirs',
    label: '常用目录',
    icon: FolderIcon,
    render: () => <QuickDirectoriesPanel />,
  },
  {
    id: 'p4-workspaces',
    label: 'P4 工作区',
    icon: BranchIcon,
    render: () => <P4WorkspacesPanel />,
  },
  {
    id: 'redmine',
    label: 'Redmine 单子',
    icon: TicketIcon,
    render: () => <RedmineIssuesPanel />,
  },
  {
    id: 'websites',
    label: '常用网站',
    icon: GlobeIcon,
    render: () => <WebsitesPanel />,
  },
  {
    id: 'p4-merge',
    label: 'p4merge',
    icon: MergeIcon,
    render: () => <P4MergePanel />,
  },
  {
    id: 'p4-path',
    label: '路径转换',
    icon: SwapIcon,
    render: () => <PathConvertPanel />,
  },
]

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
