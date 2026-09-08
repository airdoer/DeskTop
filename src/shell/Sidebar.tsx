import { useEffect, useState } from 'react'
import { C7Logo } from '@/components/ui/C7Logo'
import { ChevronDownIcon, ChevronRightIcon } from '@/components/ui/icons'
import {
  DEFAULT_EXPANDED_GROUPS,
  NAV_ITEMS,
  ROUTE_PARENT,
  type NavGroup,
  type NavItem,
  type NavLeaf,
  type RouteId,
} from './navigation'

/*
 * Sidebar — 应用主导航.
 * 依据 docs/UI_DESIGN_SYSTEM.md §4/§9：Sidebar 由 Application Shell 统一提供，
 *   一级导航稳定，复杂功能通过二级展开处理。
 * §7 Compact Density：Sidebar Item 32-40px。
 * 视觉层级用 Background + 左侧 active indicator，不用 Shadow（§16）。
 */

interface SidebarProps {
  active: RouteId
  onNavigate: (id: RouteId) => void
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(DEFAULT_EXPANDED_GROUPS))

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

  return (
    <aside className="flex flex-col w-56 shrink-0 h-full bg-surface-sidebar border-r border-border-subtle select-none">
      <BrandHeader />

      <nav className="flex-1 min-h-0 overflow-y-auto py-2 px-2">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) =>
            item.type === 'leaf' ? (
              <LeafItem
                key={item.id}
                item={item}
                active={active === item.id}
                onClick={() => onNavigate(item.id)}
              />
            ) : (
              <GroupItem
                key={item.id}
                item={item}
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

      <Footer />
    </aside>
  )
}

function BrandHeader() {
  return (
    <div className="flex items-center gap-2 h-12 px-3 border-b border-border-subtle">
      <C7Logo size={22} />
      <span className="text-[13px] font-semibold text-foreground leading-5">C7 DeskTop</span>
    </div>
  )
}

function Footer() {
  return (
    <div className="px-3 py-2 border-t border-border-subtle text-xs text-foreground-tertiary leading-4">
      v0.1.0 · chenzhixu
    </div>
  )
}

function LeafItem({
  item,
  active,
  onClick,
}: {
  item: NavLeaf
  active: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={itemClass(active)}
        aria-current={active ? 'page' : undefined}
      >
        <item.icon size={16} />
        <span className="flex-1 text-left truncate">{item.label}</span>
      </button>
    </li>
  )
}

function GroupItem({
  item,
  expanded,
  activeChild,
  activeId,
  onToggle,
  onNavigate,
}: {
  item: NavGroup
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
        className={itemClass(activeChild, true)}
        aria-expanded={expanded}
      >
        <item.icon size={16} />
        <span className="flex-1 text-left truncate">{item.label}</span>
        {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
      </button>
      {expanded && (
        <ul className="flex flex-col gap-0.5 mt-0.5 ml-3 pl-2 border-l border-border-subtle">
          {item.children.map((child) => {
            const active = activeId === child.id
            return (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(child.id)}
                  className={itemClass(active)}
                  aria-current={active ? 'page' : undefined}
                >
                  <child.icon size={15} />
                  <span className="flex-1 text-left truncate">{child.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

function itemClass(active: boolean, isGroupTrigger = false): string {
  const base = 'group flex items-center gap-2 w-full h-8 px-2 rounded-md text-[13px] transition-colors'
  if (active && !isGroupTrigger) {
    return `${base} bg-surface-active text-primary font-medium`
  }
  if (active && isGroupTrigger) {
    return `${base} text-primary`
  }
  return `${base} text-foreground-secondary hover:bg-surface-hover hover:text-foreground`
}
