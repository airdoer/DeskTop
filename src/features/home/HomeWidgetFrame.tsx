import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DragHandleIcon,
  TrashIcon,
} from '@/components/ui/icons'
import type { HomeWidget } from './homeWidgets'

/*
 * HomeWidgetFrame — 主页组件的编辑态外壳.
 *
 * 非编辑态直接渲染组件本体（不额外套 DOM），保持主页与「独立页签」观感一致。
 * 编辑态在组件上方插入一条控制条：拖动把手 + 组件名 + 上移/下移/移除。
 *   - 控制条放在组件**之外**，避免与面板标题栏右侧的刷新/视图切换按钮争抢位置。
 *   - 用虚线框标识「这是一个可编辑槽位」；虚线框只在编辑态出现，不构成常驻的 Card 套 Card。
 *
 * 拖拽用原生 HTML5 DnD（与 P4WorkspacesPanel / QuickDirectoriesPanel 的排序同一套做法）。
 */

interface HomeWidgetFrameProps {
  widget: HomeWidget
  /** 在布局中的位置，用于判断上移/下移是否可用 */
  index: number
  total: number
  editing: boolean
  /** 该组件正在被拖动（降低不透明度以示区别） */
  dragging: boolean
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (index: number, event: ReactDragEvent<HTMLElement>) => void
  onDrop: (index: number, event: ReactDragEvent<HTMLElement>) => void
  onMove: (id: string, delta: number) => void
  onRemove: (id: string) => void
  children: ReactNode
}

export function HomeWidgetFrame({
  widget,
  index,
  total,
  editing,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove,
  onRemove,
  children,
}: HomeWidgetFrameProps) {
  if (!editing) return <>{children}</>

  return (
    <div
      className={`rounded-md border border-dashed p-1.5 transition-colors ${
        dragging ? 'border-primary/50 opacity-50' : 'border-border'
      }`}
      onDragOver={(event) => onDragOver(index, event)}
      onDrop={(event) => onDrop(index, event)}
    >
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          onDragStart(widget.id)
        }}
        onDragEnd={onDragEnd}
        className="flex h-7 cursor-grab select-none items-center gap-1.5 px-1 active:cursor-grabbing"
      >
        <DragHandleIcon size={14} className="shrink-0 text-foreground-tertiary" aria-hidden />
        <span className="text-xs font-medium text-foreground-secondary">{widget.label}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <IconAction
            label={`上移 ${widget.label}`}
            disabled={index === 0}
            onClick={() => onMove(widget.id, -1)}
          >
            <ArrowUpIcon size={13} />
          </IconAction>
          <IconAction
            label={`下移 ${widget.label}`}
            disabled={index === total - 1}
            onClick={() => onMove(widget.id, 1)}
          >
            <ArrowDownIcon size={13} />
          </IconAction>
          <IconAction label={`移除 ${widget.label}`} danger onClick={() => onRemove(widget.id)}>
            <TrashIcon size={13} />
          </IconAction>
        </span>
      </div>
      {children}
    </div>
  )
}

function IconAction({
  label,
  disabled = false,
  danger = false,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? 'text-foreground-tertiary hover:bg-error/10 hover:text-error'
          : 'text-foreground-tertiary hover:bg-surface-hover hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
