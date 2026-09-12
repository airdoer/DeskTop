import type { ComponentType } from 'react'
import {
  BranchIcon,
  FolderIcon,
  GlobeIcon,
  HomeIcon,
  MergeIcon,
  MonitorIcon,
  SettingsIcon,
  SwapIcon,
  TicketIcon,
  type IconProps,
} from '@/components/ui/icons'

/*
 * Application navigation config — 由 Sidebar (Shell)、AppShell (路由) 与
 * 快捷跳转 (features/quick-nav) 共享，是导航的唯一数据源。
 *
 * 当前信息架构（用户要求）：
 *   - 主页是「可拼装仪表盘」，其余每个功能各占一个平级页签，不再有二级分组。
 *   - 系统信息 / 常用目录 / P4 工作区 / Redmine 单子 从主页面板提升为独立页签。
 *   - 原「p4工具」分组取消，p4merge 与 路径转换 变为平级页签；p4更新 占位页已删除。
 *   - 设置不再是页签，由 Sidebar 固定在「收起侧边栏」上方（仍复用 'settings' 路由）。
 *
 * NavGroup 与 ROUTE_PARENT 作为 Shell 的通用能力保留（UI_DESIGN_SYSTEM §9 允许
 *   一级导航通过二级展开处理复杂功能），但当前 NAV_ITEMS 中已无分组，故两者均为空。
 */

export type RouteId =
  | 'home'
  | 'system-info'
  | 'quick-dirs'
  | 'p4-workspaces'
  | 'redmine'
  | 'websites'
  | 'p4-merge'
  | 'p4-path'
  | 'settings'

export interface NavLeaf {
  type: 'leaf'
  id: RouteId
  label: string
  icon: ComponentType<IconProps>
}

export interface NavChild {
  id: RouteId
  label: string
  icon: ComponentType<IconProps>
}

export interface NavGroup {
  type: 'group'
  id: string
  label: string
  icon: ComponentType<IconProps>
  children: NavChild[]
}

export type NavItem = NavLeaf | NavGroup

/** 侧边栏主导航项（顺序即展示顺序）：先「本机资源」，再「站点」，最后「P4 工具」 */
export const NAV_ITEMS: NavItem[] = [
  { type: 'leaf', id: 'home', label: '主页', icon: HomeIcon },
  { type: 'leaf', id: 'system-info', label: '系统信息', icon: MonitorIcon },
  { type: 'leaf', id: 'quick-dirs', label: '常用目录', icon: FolderIcon },
  { type: 'leaf', id: 'p4-workspaces', label: 'P4 工作区', icon: BranchIcon },
  { type: 'leaf', id: 'redmine', label: 'Redmine 单子', icon: TicketIcon },
  { type: 'leaf', id: 'websites', label: '常用网站', icon: GlobeIcon },
  { type: 'leaf', id: 'p4-merge', label: 'p4merge', icon: MergeIcon },
  { type: 'leaf', id: 'p4-path', label: '路径转换', icon: SwapIcon },
]

/** 固定在侧边栏底部的导航项（不参与 NAV_ITEMS 排序，但仍是正常路由） */
export const FOOTER_NAV_ITEM: NavLeaf = {
  type: 'leaf',
  id: 'settings',
  label: '设置',
  icon: SettingsIcon,
}

/** 父级 route：子项 → 所属分组（用于自动展开）；当前无分组 */
export const ROUTE_PARENT: Partial<Record<RouteId, string>> = {}

/** 默认展开的分组；当前无分组 */
export const DEFAULT_EXPANDED_GROUPS: string[] = []
