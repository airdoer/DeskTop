import type { ReactNode } from 'react'

/*
 * EmptyState — 统一空状态.
 * 依据 docs/UI_DESIGN_SYSTEM.md §21：Empty State 应清晰、简短、可操作。
 *   避免大型插画与营销文案；左对齐，克制。
 */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-1.5 py-6">
      <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
      {hint && <p className="text-xs text-foreground-secondary max-w-md leading-5">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
