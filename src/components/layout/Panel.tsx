import type { ReactNode } from 'react'
import { InfoTip } from '@/components/ui/InfoTip'

/*
 * Panel — 独立功能区域容器.
 * 依据 docs/UI_DESIGN_SYSTEM.md §17 Card Rules：Card/Panel 用于独立的信息区域或功能模块。
 *   - 禁止 Table 外套 Panel、Panel 内再套 Panel（Card Pyramid）。
 *   - 用 Background + Border + Spacing 区分层级，不用 Shadow（§16）。
 * §27 component architecture 将 Panel 归入 layout/。
 *
 * 说明文字一律走 help（标题旁气泡），不用第二行描述：标题区固定 h-10 单行，
 * 描述换行会把 header 撑高、并把右侧 actions 挤到垂直居中之外。
 */

export function Panel({
  title,
  icon,
  help,
  actions,
  children,
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
  bodyClassName?: string
  className?: string
}) {
  return (
    <section className={`rounded-md border border-border-subtle bg-surface-1 ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-3 h-10 border-b border-border-subtle bg-surface-header rounded-t-md">
          <div className="flex items-center gap-1.5 min-w-0">
            {icon && (
              <span className="shrink-0 flex items-center text-foreground-secondary" aria-hidden>
                {icon}
              </span>
            )}
            <div className="flex items-center gap-1 min-w-0">
              {title && (
                <h2 className="text-[13px] font-medium text-foreground leading-5 truncate">
                  {title}
                </h2>
              )}
              {help && <InfoTip content={help} label={typeof title === 'string' ? `${title}说明` : '说明'} />}
            </div>
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={`p-3 ${bodyClassName}`}>{children}</div>
    </section>
  )
}
