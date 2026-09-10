import { useState, type ReactNode } from 'react'
import { InfoTip } from '@/components/ui/InfoTip'
import { ChevronDownIcon, ChevronRightIcon } from '@/components/ui/icons'

/*
 * Panel — 独立功能区域容器.
 * 依据 docs/UI_DESIGN_SYSTEM.md §17 Card Rules：Card/Panel 用于独立的信息区域或功能模块。
 *   - 禁止 Table 外套 Panel、Panel 内再套 Panel（Card Pyramid）。
 *   - 用 Background + Border + Spacing 区分层级，不用 Shadow（§16）。
 * §27 component architecture 将 Panel 归入 layout/。
 *
 * 说明文字一律走 help（标题旁气泡），不用第二行描述：标题区固定单行，
 * 描述换行会把 header 撑高、并把右侧 actions 挤到垂直居中之外。
 *
 * 折叠能力（collapsible）：标题区可点击切换展开/折叠，用 Chevron 图标指示状态。
 *   - 受控用法：外部传 collapsed + onToggleCollapsed（用于持久化折叠状态）
 *   - 非受控用法：只传 collapsible + defaultCollapsed，Panel 自管状态
 * 折叠时隐藏 body，header 保留（底边随折叠收起，避免双线）。
 *
 * 标题区配色：header 背景用 surface-header（#f0f0f2），比内容区 surface-1（#fff）
 * 略深，配底边 border（#d9d9d9）形成清晰分层；标题用 font-medium 提升视觉权重。
 */

export function Panel({
  title,
  icon,
  help,
  actions,
  children,
  collapsible = false,
  defaultCollapsed = false,
  collapsed: collapsedProp,
  onToggleCollapsed,
  bodyClassName = '',
  className = '',
}: {
  title?: ReactNode
  /** 标题前置图标（§14 统一线性图标，建议 size=14），与标题行首行对齐 */
  icon?: ReactNode
  /** 标题旁的说明：点击 "?" 以气泡展示，不占标题第二行 */
  help?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** 是否可折叠；true 时标题区可点击切换 */
  collapsible?: boolean
  /** 非受控初始折叠状态；受控时以 collapsed prop 为准 */
  defaultCollapsed?: boolean
  /** 受控折叠状态；传入时由外部管理 */
  collapsed?: boolean
  /** 折叠切换回调（受控模式由外部持久化） */
  onToggleCollapsed?: () => void
  bodyClassName?: string
  className?: string
}) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const isControlled = collapsedProp !== undefined
  const collapsed = isControlled ? collapsedProp : internalCollapsed

  const toggle = () => {
    if (!collapsible) return
    if (isControlled) onToggleCollapsed?.()
    else setInternalCollapsed((v) => !v)
  }

  return (
    <section className={`rounded-md border border-border bg-surface-1 ${className}`}>
      {(title || actions) && (
        <header
          className={`flex items-center justify-between gap-2 px-3 h-10 bg-surface-header rounded-t-md ${
            collapsed ? '' : 'border-b border-border'
          } ${collapsible ? 'cursor-pointer select-none hover:bg-surface-hover transition-colors' : ''}`}
          onClick={collapsible ? toggle : undefined}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? !collapsed : undefined}
          onKeyDown={
            collapsible
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggle()
                  }
                }
              : undefined
          }
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {collapsible && (
              <span className="shrink-0 flex items-center text-foreground-tertiary" aria-hidden>
                {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
              </span>
            )}
            {icon && (
              <span className="shrink-0 flex items-center text-foreground-secondary" aria-hidden>
                {icon}
              </span>
            )}
            <div className="flex items-center gap-1 min-w-0">
              {title && (
                <h2 className="text-[13px] font-semibold text-foreground leading-5 truncate">
                  {title}
                </h2>
              )}
              {help && (
                <span
                  onClick={(e) => e.stopPropagation()}
                  className="app-region-no-drag"
                >
                  <InfoTip
                    content={help}
                    label={typeof title === 'string' ? `${title}说明` : '说明'}
                  />
                </span>
              )}
            </div>
          </div>
          {actions && (
            <div
              className="flex items-center gap-1.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {actions}
            </div>
          )}
        </header>
      )}
      {!collapsed && <div className={`p-3 ${bodyClassName}`}>{children}</div>}
    </section>
  )
}
