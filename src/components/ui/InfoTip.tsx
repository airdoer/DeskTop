import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { HelpIcon } from './icons'

/*
 * InfoTip — 标题旁的说明气泡（点击展开）.
 * 依据 docs/UI_DESIGN_SYSTEM.md §27：ui/AppTooltip 一类轻量提示归 ui/；
 * §16 用 Background + Border + Spacing 区分层级，不用 Shadow。
 *
 * 用于把原本会撑成第二行的描述文字收进气泡，标题区保持单行。
 * 交互：点击切换；点击外部或 Esc 关闭；气泡本身不参与拖拽（app-region-no-drag）。
 */

export function InfoTip({ content, label = '说明' }: { content: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const tooltipId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span ref={ref} className="relative inline-flex shrink-0 items-center app-region-no-drag">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded-full p-0.5 text-foreground-tertiary transition-colors hover:bg-surface-3 hover:text-foreground-secondary focus-visible:bg-surface-3 focus-visible:outline-none"
      >
        <HelpIcon size={13} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={tooltipId}
          className="absolute left-0 top-full z-20 mt-1.5 w-max max-w-[220px] rounded-md border border-border bg-surface-3 px-2 py-1.5 text-xs leading-4 text-foreground-secondary"
        >
          {content}
        </span>
      )}
    </span>
  )
}
