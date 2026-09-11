import type { ComponentType } from 'react'
import {
  HomeIcon,
  SettingsIcon,
  ToolsIcon,
  RefreshArrowIcon,
  FolderOpenIcon,
  GlobeIcon,
  SwapIcon,
  type IconProps,
} from '@/components/ui/icons'

/*
 * Application navigation config — 由 Sidebar (Shell) 与 AppShell (路由) 共享.
 * 依据需求：主页 / 设置 / p4工具，p4工具 可展开二级（p4更新、p4merge 等）。
 */

export type RouteId =
  | 'home'
  | 'websites'
  | 'settings'
  | 'p4'
  | 'p4-update'
  | 'p4-merge'
  | 'p4-path'

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

export const NAV_ITEMS: NavItem[] = [
  { type: 'leaf', id: 'home', label: '主页', icon: HomeIcon },
  { type: 'leaf', id: 'websites', label: '常用网站', icon: GlobeIcon },
  { type: 'leaf', id: 'settings', label: '设置', icon: SettingsIcon },
  {
    type: 'group',
    id: 'p4-group',
    label: 'p4工具',
    icon: ToolsIcon,
    children: [
      { id: 'p4-update', label: 'p4更新', icon: RefreshArrowIcon },
      { id: 'p4-merge', label: 'p4merge', icon: FolderOpenIcon },
      { id: 'p4-path', label: '路径转换', icon: SwapIcon },
    ],
  },
]

/** 父级 route：子项 → 所属分组（用于自动展开） */
export const ROUTE_PARENT: Partial<Record<RouteId, string>> = {
  'p4-update': 'p4-group',
  'p4-merge': 'p4-group',
  'p4-path': 'p4-group',
}

/** 默认展开的分组 */
export const DEFAULT_EXPANDED_GROUPS: string[] = ['p4-group']
