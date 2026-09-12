import type { ComponentType } from 'react'
import type { IconProps } from '@/components/ui/icons'
import { FOOTER_NAV_ITEM, NAV_ITEMS, type NavItem, type RouteId } from '@/shell/navigation'
import type { QuickNavCandidate } from '@/services/quickNav'

/*
 * 快捷跳转条目源 — 把侧边栏菜单树拍平成可检索、可跳转的条目列表.
 *
 * 设计取舍：
 * 1. 数据源就是 Sidebar 用的同一份 NAV_ITEMS，因此「侧边栏有什么，快捷跳转就能搜到什么」，
 *    不存在两处维护导致的不一致；固定在侧边栏底部的「设置」也是可达路由，故一并收录。
 * 2. 只收录叶子节点（= 真正对应 Page 的路由）。分组本身没有页面，跳过去没有落点；
 *    但分组名会作为 crumb 与 keywords 参与匹配，所以搜「p4工具」仍能列出其下子项。
 * 3. icon 直接复用导航项图标，保证浮层与侧边栏的视觉语言完全一致（§14 单一 Icon System）。
 */

export interface QuickNavEntry extends QuickNavCandidate {
  id: RouteId
  label: string
  /** 所属分组名；顶层条目为空串 */
  crumb: string
  icon: ComponentType<IconProps>
  /** 附加检索词：路由 id + 标题 + 分组名，便于用英文（如 home / websites）命中中文菜单 */
  keywords: string
}

/** 侧边栏菜单树 → 快捷跳转条目（叶子优先，保持声明顺序） */
export function buildQuickNavEntries(items: readonly NavItem[]): QuickNavEntry[] {
  const entries: QuickNavEntry[] = []
  for (const item of items) {
    if (item.type === 'leaf') {
      entries.push(toEntry(item.id, item.label, '', item.icon))
      continue
    }
    for (const child of item.children) {
      entries.push(toEntry(child.id, child.label, item.label, child.icon))
    }
  }
  return entries
}

function toEntry(
  id: RouteId,
  label: string,
  crumb: string,
  icon: ComponentType<IconProps>,
): QuickNavEntry {
  return { id, label, crumb, icon, keywords: `${id} ${label} ${crumb}`.toLowerCase() }
}

/** 全局唯一的条目快照：菜单是静态配置，构建一次即可（主导航 + 固定在底部的设置） */
export const QUICK_NAV_ENTRIES: QuickNavEntry[] = buildQuickNavEntries([
  ...NAV_ITEMS,
  FOOTER_NAV_ITEM,
])
