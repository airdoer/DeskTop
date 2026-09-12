import type { ComponentType } from 'react'
import type { IconProps } from '@/components/ui/icons'
import {
  FOOTER_NAV_ITEM,
  NAV_ITEMS,
  collectNavLeaves,
  type NavItem,
  type RouteId,
} from '@/shell/navigation'
import type { QuickNavCandidate } from '@/services/quickNav'

/*
 * 快捷跳转条目源 — 把侧边栏菜单树拍平成可检索、可跳转的条目列表.
 *
 * 设计取舍：
 * 1. 数据源就是 Sidebar 用的同一份 NAV_ITEMS，因此「侧边栏有什么，快捷跳转就能搜到什么」，
 *    不存在两处维护导致的不一致；固定在侧边栏底部的「设置」也是可达路由，故一并收录。
 * 2. 只收录叶子节点（= 真正对应 Page 的路由）。分组本身没有页面，跳过去没有落点；
 *    但分组名会作为 crumb 与 keywords 参与匹配，所以搜「p4工具」仍能列出其下子项。
 * 3. 拍平逻辑复用 navigation.collectNavLeaves——与主页组件注册表同源，
 *    icon / iconColor 直接沿用导航项，保证浮层与侧边栏的视觉语言完全一致（§14 单一 Icon System）。
 */

export interface QuickNavEntry extends QuickNavCandidate {
  id: RouteId
  label: string
  /** 所属分组名；顶层条目为空串 */
  crumb: string
  icon: ComponentType<IconProps>
  /** 图标识别色，与侧边栏页签一致（brandColors.NAV_ICON_COLORS） */
  iconColor: string
  /** 附加检索词：路由 id + 标题 + 分组名，便于用英文（如 home / websites）命中中文菜单 */
  keywords: string
}

/** 侧边栏菜单树 → 快捷跳转条目（叶子优先，保持声明顺序） */
export function buildQuickNavEntries(items: readonly NavItem[]): QuickNavEntry[] {
  return collectNavLeaves(items).map((leaf) => ({
    ...leaf,
    keywords: `${leaf.id} ${leaf.label} ${leaf.crumb}`.toLowerCase(),
  }))
}

/** 全局唯一的条目快照：菜单是静态配置，构建一次即可（主导航 + 固定在底部的设置） */
export const QUICK_NAV_ENTRIES: QuickNavEntry[] = buildQuickNavEntries([
  ...NAV_ITEMS,
  FOOTER_NAV_ITEM,
])
