import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'

/*
 * AppInput — 项目统一输入框 wrapper.
 * 依据 docs/UI_DESIGN_SYSTEM.md §7 Compact Density (Input Height 32-40px),
 * §6 小圆角, §19 Form Rules (Label Clear / Layout Compact / Validation Inline).
 *
 * 规范 §29：业务代码禁止直接散用 <Input/>，必须通过 wrapper 统一风格。
 */

export type AppInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'suffix'> & {
  prefix?: ReactNode
  suffix?: ReactNode
  invalid?: boolean
  block?: boolean
}

export const AppInput = forwardRef<HTMLInputElement, AppInputProps>(function AppInput(
  {
    prefix,
    suffix,
    invalid = false,
    block = true,
    className = '',
    disabled,
    ...rest
  },
  ref,
) {
  const wrapperClasses = [
    'inline-flex items-center h-8 rounded-md border bg-surface-1 transition-colors',
    invalid
      ? 'border-error focus-within:outline-2 focus-within:-outline-offset-2 outline-error'
      : 'border-border focus-within:border-primary focus-within:outline-2 focus-within:-outline-offset-2 outline-primary',
    disabled ? 'opacity-60 cursor-not-allowed' : '',
    block ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={wrapperClasses}>
      {prefix && <span className="flex items-center pl-2 text-foreground-tertiary shrink-0">{prefix}</span>}
      <input
        ref={ref}
        disabled={disabled}
        className="flex-1 min-w-0 bg-transparent px-2 text-[13px] text-foreground placeholder:text-foreground-quaternary focus:outline-none"
        {...rest}
      />
      {suffix && <span className="flex items-center pr-2 text-foreground-tertiary shrink-0">{suffix}</span>}
    </span>
  )
})
