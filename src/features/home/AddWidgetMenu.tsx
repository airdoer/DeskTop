import { useEffect, useRef, useState } from 'react'
import { AppButton } from '@/components/ui/AppButton'
import { PlusIcon } from '@/components/ui/icons'
import type { HomeWidget, HomeWidgetId } from './homeWidgets'

/*
 * AddWidgetMenu — 主页「添加组件」下拉菜单.
 * 与 UserMenu 用同一套交互约定：容器 ref + pointerdown 外部关闭 + Esc 关闭；
 * 浮层样式同样走 border + surface-1 + 轻阴影（§16 允许 Dropdown 使用 Shadow）。
 *
 * 只列出「尚未添加」的组件；全部添加完时给出说明而不是渲染一个空菜单。
 */

interface AddWidgetMenuProps {
  available: readonly HomeWidget[]
  onAdd: (id: HomeWidgetId) => void
}

export function AddWidgetMenu({ available, onAdd }: AddWidgetMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <AppButton
        size="sm"
        variant="default"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PlusIcon size={13} aria-hidden />
        添加组件
      </AppButton>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-md border border-border bg-surface-1 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.15)]"
        >
          {available.length === 0 ? (
            <div className="px-3 py-2 text-xs text-foreground-tertiary">全部组件已添加</div>
          ) : (
            available.map((widget) => (
              <button
                key={widget.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onAdd(widget.id)
                }}
                className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <widget.icon size={14} className="shrink-0 text-foreground-tertiary" aria-hidden />
                <span className="truncate">{widget.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
