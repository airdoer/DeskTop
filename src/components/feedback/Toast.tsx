import { useSyncExternalStore, type ReactNode } from 'react'
import { CheckIcon, CloseIcon, RefreshIcon } from '@/components/ui/icons'

/*
 * Toast — 统一短暂反馈 Service.
 * 依据 docs/UI_DESIGN_SYSTEM.md §11.1（Toast：短暂、非阻塞、自动消失）+ §12.1
 * （业务代码禁止直接控制 Toast，统一通过 notify service 决定展示方式）。
 *
 * 业务代码调用：toast.success('已复制') / toast.error('路径不存在') 等。
 * ToastContainer 由 AppShell 统一挂载在右下角。
 */

type ToastType = 'success' | 'error' | 'info' | 'warning'
interface ToastItem {
  id: number
  type: ToastType
  message: string
  duration: number
}

let items: ToastItem[] = []
const listeners = new Set<() => void>()
let seq = 0

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ToastItem[] {
  return items
}

function add(type: ToastType, message: string, duration = 2000) {
  const id = ++seq
  items = [...items, { id, type, message, duration }]
  emit()
  if (duration > 0) {
    window.setTimeout(() => remove(id), duration)
  }
  return id
}

function remove(id: number) {
  items = items.filter((i) => i.id !== id)
  emit()
}

export const toast = {
  success: (m: string, d?: number) => add('success', m, d),
  error: (m: string, d?: number) => add('error', m, d ?? 3000),
  info: (m: string, d?: number) => add('info', m, d),
  warning: (m: string, d?: number) => add('warning', m, d ?? 3000),
  dismiss: remove,
}

const TYPE_META: Record<ToastType, { icon: ReactNode; color: string }> = {
  success: { icon: <CheckIcon size={14} />, color: 'text-success' },
  error: { icon: <CloseIcon size={14} />, color: 'text-error' },
  info: { icon: <RefreshIcon size={14} />, color: 'text-info' },
  warning: { icon: <RefreshIcon size={14} />, color: 'text-warning' },
}

export function ToastContainer() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return (
    <div
      className="fixed z-50 bottom-4 right-4 flex flex-col gap-1.5 pointer-events-none"
      aria-live="polite"
    >
      {current.map((t) => {
        const meta = TYPE_META[t.type]
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-surface-1 text-[13px] text-foreground shadow-[0_4px_12px_-4px_rgba(0,0,0,0.15)]"
            role="status"
          >
            <span className={meta.color}>{meta.icon}</span>
            <span className="whitespace-nowrap">{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}
