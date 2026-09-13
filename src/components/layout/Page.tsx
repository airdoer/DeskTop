import type { ReactNode } from 'react'

/*
 * Page / PageHeader / PageBody — 页面布局组件.
 * 依据 docs/UI_DESIGN_SYSTEM.md §8 Page Layout：
 *   Page Header = Title (+ Optional Title Aside) + Optional Description + Primary Actions
 *   禁止居中、大空白的 Landing Page 风格。
 *   主操作右上、1-2 个；二级操作放 More Menu。
 *
 * 所有业务页面应使用 <Page><PageHeader/><PageBody/></Page> 结构。
 */

export function Page({ children }: { children: ReactNode }) {
  return <div className="flex flex-col h-full min-w-0">{children}</div>
}

export function PageHeader({
  title,
  description,
  actions,
  titleAside,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /**
   * 标题**同一行**右侧的补充内容（如「可拼装」这类语义标识 + 标语）.
   * 与 description 的区别：description 占第二行、用于操作说明；
   * titleAside 不占行高，适合一句短语或图标，窗口变窄时先被截断。
   */
  titleAside?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border-subtle">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-base font-semibold text-foreground leading-6 truncate shrink-0">{title}</h1>
          {titleAside && (
            <div className="min-w-0 truncate text-xs text-foreground-secondary leading-5">{titleAside}</div>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-xs text-foreground-secondary leading-4 truncate">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

export function PageBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex-1 min-h-0 overflow-auto p-4 ${className}`}>{children}</div>
  )
}
