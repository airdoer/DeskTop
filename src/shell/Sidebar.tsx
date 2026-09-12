import { useEffect, useState } from 'react'
import { C7Logo } from '@/components/ui/C7Logo'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
} from '@/components/ui/icons'
import { readSidebarCollapsed, saveSidebarCollapsed } from '@/services/uiPreferences'
import {
  DEFAULT_EXPANDED_GROUPS,
  FOOTER_NAV_ITEM,
  NAV_ITEMS,
  ROUTE_PARENT,
  type NavGroup,
  type NavLeaf,
  type RouteId,
} from './navigation'

/*
 * Sidebar — 应用主导航.
 * 依据 docs/UI_DESIGN_SYSTEM.md §4/§9：Sidebar 由 Application Shell 统一提供，
 *   一级导航稳定，复杂功能通过二级展开处理。
 * §7 Compact Density：Sidebar Item 32-40px。
 * 视觉层级用 Background + 左侧 active indicator，不用 Shadow（§16）。
 *
 * 支持整体收起为图标列（rail）：宽度 224px → 56px，只保留图标，label 走原生 title
 *   提示（nav 是 overflow-y-auto 容器，自定义气泡会被裁剪）。收起状态经 ui-prefs 持久化。
 *
 * 底部固定区（不随 nav 滚动）：设置 → 收起/展开侧边栏 → 版本号。
 *   「设置」不是主导航页签，固定在此处（FOOTER_NAV_ITEM），高亮规则与主导航项一致。
 *
 * 图标识别色（item.iconColor，来自 brandColors.NAV_ICON_COLORS）：
 *   以 inline style 落在图标自身，**不随激活态变色**——激活态靠 bg-surface-active +
 *   font-medium 表达。这样收起成图标列（rail）时仍能靠颜色区分页签，
 *   否则 rail 里所有激活项都会变成同一个 primary 蓝，反而失去识别度。
 *   文字仍走 text-* 类，激活时为主色，保证「当前在哪一页」一眼可见。
 */

interface SidebarProps {
  active: RouteId
  onNavigate: (id: RouteId) => void
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(DEFAULT_EXPANDED_GROUPS))

  // 收起状态从 Main Process 读回（面板首帧用默认值，读回后纠正，与视图模式一致的取舍）
  useEffect(() => {
    let alive = true
    readSidebarCollapsed().then((value) => {
      if (alive) setCollapsed(value)
    })
    return () => {
      alive = false
    }
  }, [])

  // 当 active route 属于某个分组时，自动展开该分组
  useEffect(() => {
    const parent = ROUTE_PARENT[active]
    if (parent && !expanded.has(parent)) {
      setExpanded((prev) => new Set([...prev, parent]))
    }
  }, [active, expanded])

  const toggleGroup = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      void saveSidebarCollapsed(next)
      return next
    })
  }

  return (
    <aside
      className={`flex flex-col h-full shrink-0 bg-surface-sidebar border-r border-border-subtle select-none transition-[width] duration-200 ease-out ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      <BrandHeader collapsed={collapsed} />

      <nav className="flex-1 min-h-0 overflow-y-auto py-2 px-2">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) =>
            item.type === 'leaf' ? (
              <LeafItem
                key={item.id}
                item={item}
                collapsed={collapsed}
                active={active === item.id}
                onClick={() => onNavigate(item.id)}
              />
            ) : (
              <GroupItem
                key={item.id}
                item={item}
                collapsed={collapsed}
                expanded={expanded.has(item.id)}
                activeChild={item.children.some((c) => c.id === active)}
                activeId={active}
                onToggle={() => toggleGroup(item.id)}
                onNavigate={onNavigate}
              />
            ),
          )}
        </ul>
      </nav>

      {/* 固定在底部：设置 → 收起侧边栏 → 版本号（设置不再是主导航页签，见 navigation.ts） */}
      <div className="px-2 pb-1.5">
        <ul className="flex flex-col gap-0.5">
          <LeafItem
            item={FOOTER_NAV_ITEM}
            collapsed={collapsed}
            active={active === FOOTER_NAV_ITEM.id}
            onClick={() => onNavigate(FOOTER_NAV_ITEM.id)}
          />
        </ul>
      </div>
      <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} />
      <Footer collapsed={collapsed} />
    </aside>
  )
}

function BrandHeader({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={`app-region-drag flex items-center h-12 border-b border-border-subtle ${
        collapsed ? 'justify-center px-0' : 'gap-2 px-3'
      }`}
    >
      <C7Logo size={22} />
      {!collapsed && (
        <span className="text-[13px] font-semibold text-foreground leading-5 truncate">
          C7 DeskTop
        </span>
      )}
    </div>
  )
}

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="border-t border-border-subtle p-1.5">
      <button
        type="button"
        onClick={onToggle}
        className={`group flex items-center h-8 rounded-md text-[13px] text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground ${
          collapsed ? 'w-full justify-center' : 'w-full gap-2 px-2'
        }`}
        title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        aria-expanded={!collapsed}
      >
        {collapsed ? <SidebarExpandIcon size={16} /> : <SidebarCollapseIcon size={16} />}
        {!collapsed && <span className="flex-1 text-left truncate">收起侧边栏</span>}
      </button>
    </div>
  )
}

function Footer({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={`px-2 py-2 border-t border-border-subtle text-xs text-foreground-tertiary leading-4 ${
        collapsed ? 'text-center text-[10px]' : 'px-3'
      }`}
    >
      {collapsed ? 'v0.1' : 'v0.1.0 · chenzhixu'}
    </div>
  )
}

function LeafItem({
  item,
  collapsed,
  active,
  onClick,
}: {
  item: NavLeaf
  collapsed: boolean
  active: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={itemClass(active, false, collapsed)}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
      >
        <item.icon size={16} style={{ color: item.iconColor }} />
        {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
      </button>
    </li>
  )
}

function GroupItem({
  item,
  collapsed,
  expanded,
  activeChild,
  activeId,
  onToggle,
  onNavigate,
}: {
  item: NavGroup
  collapsed: boolean
  expanded: boolean
  activeChild: boolean
  activeId: RouteId
  onToggle: () => void
  onNavigate: (id: RouteId) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={itemClass(activeChild, true, collapsed)}
        aria-expanded={expanded}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
      >
        <item.icon size={16} style={{ color: item.iconColor }} />
        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">{item.label}</span>
            {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </>
        )}
      </button>
      {expanded && (
        <ul
          className={`flex flex-col gap-0.5 mt-0.5 ${
            collapsed ? 'items-center' : 'ml-3 pl-2 border-l border-border-subtle'
          }`}
        >
          {item.children.map((child) => {
            const active = activeId === child.id
            return (
              <li key={child.id} className="w-full">
                <button
                  type="button"
                  onClick={() => onNavigate(child.id)}
                  className={itemClass(active, false, collapsed)}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? child.label : undefined}
                  aria-label={collapsed ? child.label : undefined}
                >
                  <child.icon
                    size={collapsed ? 14 : 15}
                    style={{ color: child.iconColor }}
                  />
                  {!collapsed && <span className="flex-1 text-left truncate">{child.label}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

function itemClass(active: boolean, isGroupTrigger = false, collapsed = false): string {
  const base =
    'group flex items-center gap-2 w-full h-8 px-2 rounded-md text-[13px] transition-colors'
  const rail = collapsed ? 'justify-center px-0' : ''
  if (active && !isGroupTrigger) {
    return `${base} ${rail} bg-surface-active text-primary font-medium`
  }
  if (active && isGroupTrigger) {
    return `${base} ${rail} text-primary`
  }
  return `${base} ${rail} text-foreground-secondary hover:bg-surface-hover hover:text-foreground`
}
