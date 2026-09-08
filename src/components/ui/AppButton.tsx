import { forwardRef, type ButtonHTMLAttributes } from 'react'

/*
 * AppButton — 项目统一按钮组件 wrapper.
 * 依据 docs/UI_DESIGN_SYSTEM.md §7 Compact Density (Button Height 28-36px),
 * §6 小圆角 (radius sm/md), §20 局部 Loading (按钮内 spinner 而非全屏).
 *
 * 规范 §29：业务代码禁止直接散用 <Button/>，必须通过 wrapper 统一风格。
 */

type Variant = 'primary' | 'default' | 'ghost' | 'danger' | 'link'
type Size = 'sm' | 'md'

export type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  block?: boolean
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-primary text-white border border-transparent hover:bg-primary-hover active:bg-primary-active focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary',
  default:
    'bg-surface-1 text-foreground border border-border hover:border-primary-hover hover:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary',
  ghost:
    'bg-transparent text-foreground border border-transparent hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary',
  danger:
    'bg-error text-white border border-transparent hover:bg-error/90 active:bg-error focus-visible:outline-2 focus-visible:-outline-offset-2 outline-error',
  link:
    'bg-transparent text-primary border border-transparent hover:underline px-0 py-0 h-auto',
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs gap-1',
  md: 'h-8 px-3 text-[13px] gap-1.5',
}

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  {
    variant = 'default',
    size = 'md',
    loading = false,
    block = false,
    disabled,
    className = '',
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isLink = variant === 'link'
  const classes = [
    'inline-flex items-center justify-center font-medium rounded-md transition-colors select-none',
    isLink ? '' : SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    block ? 'w-full' : '',
    disabled || loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={classes}
      {...rest}
    >
      {loading && (
        <span
          className="inline-block rounded-full border-[1.5px] border-current border-t-transparent animate-spin"
          style={{ width: size === 'sm' ? 11 : 12, height: size === 'sm' ? 11 : 12 }}
          aria-hidden
        />
      )}
      {children}
    </button>
  )
})
