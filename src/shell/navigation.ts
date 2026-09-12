import type { ComponentType } from 'react'
import { NAV_ICON_COLORS } from '@/components/ui/brandColors'
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
 *
 * 每个页签带 iconColor（识别色）。同一份「图标 + 识别色」被四处共用，保证完全一致：
 *   - Sidebar（页签）
 *   - 快捷跳转浮层（features/quick-nav/entries.ts）
 *   - 主页「添加组件」菜单与组件槽位（features/home/homeWidgets.tsx）
 *   - 各功能面板的标题图标（features/*，经 navLeaf(id) 查表）
 *   色值来源见 components/ui/brandColors.ts。
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
  /**
   * 图标识别色（来自 components/ui/brandColors.ts 的 NAV_ICON_COLORS）。
   * 必填而非可选：每个页签都应有稳定的识别色，缺色会让侧边栏看起来像半成品。
   * 这些色是为 16px 线性图标在浅底（含激活态 #e6f4ff）上可读而挑的，对比度门槛见 test/nav-colors.test.ts。
   *   同一份色值被四处共用，保证完全一致：侧边栏页签、快捷跳转浮层、主页组件菜单、各功能面板标题
   *   （面板标题经 navLeaf(id) 取 NavIcon，与侧边栏页签是同一图标 + 同一色，不存在两处漂移）。
   */
  iconColor: string
}

export interface NavChild {
  id: RouteId
  label: string
  icon: ComponentType<IconProps>
  iconColor: string
}

export interface NavGroup {
  type: 'group'
  id: string
  label: string
  icon: ComponentType<IconProps>
  iconColor: string
  children: NavChild[]
}

export type NavItem = NavLeaf | NavGroup

/** 侧边栏主导航项（顺序即展示顺序）：先「本机资源」，再「站点」，最后「P4 工具」 */
export const NAV_ITEMS: NavItem[] = [
  { type: 'leaf', id: 'home', label: '主页', icon: HomeIcon, iconColor: NAV_ICON_COLORS.home },
  {
    type: 'leaf',
    id: 'system-info',
    label: '系统信息',
    icon: MonitorIcon,
    iconColor: NAV_ICON_COLORS.systemInfo,
  },
  {
    type: 'leaf',
    id: 'quick-dirs',
    label: '常用目录',
    icon: FolderIcon,
    iconColor: NAV_ICON_COLORS.quickDirs,
  },
  {
    type: 'leaf',
    id: 'p4-workspaces',
    label: 'P4 工作区',
    icon: BranchIcon,
    iconColor: NAV_ICON_COLORS.p4Workspaces,
  },
  {
    type: 'leaf',
    id: 'redmine',
    label: 'Redmine 单子',
    icon: TicketIcon,
    iconColor: NAV_ICON_COLORS.redmine,
  },
  {
    type: 'leaf',
    id: 'websites',
    label: '常用网站',
    icon: GlobeIcon,
    iconColor: NAV_ICON_COLORS.websites,
  },
  {
    type: 'leaf',
    id: 'p4-merge',
    label: 'p4merge',
    icon: MergeIcon,
    iconColor: NAV_ICON_COLORS.p4Merge,
  },
  {
    type: 'leaf',
    id: 'p4-path',
    label: '路径转换',
    icon: SwapIcon,
    iconColor: NAV_ICON_COLORS.p4Path,
  },
]

/** 固定在侧边栏底部的导航项（不参与 NAV_ITEMS 排序，但仍是正常路由） */
export const FOOTER_NAV_ITEM: NavLeaf = {
  type: 'leaf',
  id: 'settings',
  label: '设置',
  icon: SettingsIcon,
  iconColor: NAV_ICON_COLORS.settings,
}

/** 父级 route：子项 → 所属分组（用于自动展开）；当前无分组 */
export const ROUTE_PARENT: Partial<Record<RouteId, string>> = {}

/** 默认展开的分组；当前无分组 */
export const DEFAULT_EXPANDED_GROUPS: string[] = []

/**
 * 导航树叶子项的拍平形态 —— 分组本身没有页面，只贡献 crumb。
 * 三个消费方共用同一份拍平结果，保证「标题 / 图标 / 识别色」不会各处各写一份而漂移：
 *   - Sidebar（直接消费 NAV_ITEMS，不需要拍平）
 *   - 快捷跳转浮层（features/quick-nav/entries.ts）
 *   - 主页组件注册表（features/home/homeWidgets.tsx）
 */
export interface NavLeafEntry {
  id: RouteId
  label: string
  icon: ComponentType<IconProps>
  iconColor: string
  /** 所属分组名；顶层条目为空串 */
  crumb: string
}

/** 按声明顺序拍平导航树为叶子列表（叶子优先，分组名进 crumb） */
export function collectNavLeaves(items: readonly NavItem[]): NavLeafEntry[] {
  const leaves: NavLeafEntry[] = []
  for (const item of items) {
    if (item.type === 'leaf') {
      leaves.push({
        id: item.id,
        label: item.label,
        icon: item.icon,
        iconColor: item.iconColor,
        crumb: '',
      })
      continue
    }
    for (const child of item.children) {
      leaves.push({
        id: child.id,
        label: child.label,
        icon: child.icon,
        iconColor: child.iconColor,
        crumb: item.label,
      })
    }
  }
  return leaves
}

/** 全量叶子项（含固定在底部的设置），构建一次即可——导航是静态配置 */
const NAV_LEAVES: NavLeafEntry[] = collectNavLeaves([...NAV_ITEMS, FOOTER_NAV_ITEM])

/**
 * 按路由 id 取导航叶子项（图标 / 识别色 / 标题）。
 *
 * 面板标题（features/* 的 Panel）用它取「与侧边栏页签完全相同的图标与识别色」，
 *   于是「点哪个页签 → 落到哪个面板」在视觉上是一件事，而不是两处各写一份等它们漂移。
 * 找不到时抛错而非返回 undefined：这是开发期的配置错误（新增 RouteId 却漏配 NAV_ITEMS），
 *   静默降级只会让界面悄悄变丑，不如当场炸掉；覆盖性由 test/nav-colors.test.ts 锁定。
 */
export function navLeaf(id: RouteId): NavLeafEntry {
  const leaf = NAV_LEAVES.find((item) => item.id === id)
  if (!leaf) throw new Error(`navigation: 找不到路由 ${id} 对应的导航项`)
  return leaf
}
