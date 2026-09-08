import type { ReactNode } from 'react'

/*
 * Panel — 独立功能区域容器.
 * 依据 docs/UI_DESIGN_SYSTEM.md §17 Card Rules：Card/Panel 用于独立的信息区域或功能模块。
 *   - 禁止 Table 外套 Panel、Panel 内再套 Panel（Card Pyramid）。
 *   - 用 Background + Border + Spacing 区分层级，不用 Shadow（§16）。
 * §27 component architecture 将 Panel 归入 layout/。
 */

export function Panel({
  title,
  description,
  actions,
  children,
  bodyClassName = '',
  className = '',
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  bodyClassName?: string
  className?: string
}) {
  return (
    <section className={`rounded-md border border-border-subtle bg-surface-1 ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-3 h-10 border-b border-border-subtle">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-medium text-foreground leading-5 truncate">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-xs text-foreground-tertiary leading-4 truncate">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={`p-3 ${bodyClassName}`}>{children}</div>
    </section>
  )
}
