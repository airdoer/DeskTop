import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/*
 * ResizableTable — 支持拖拽调整列宽的表格.
 * 实现：用 <colgroup><col> 定义列宽，表头每个 <th> 右边缘放一个拖拽手柄，
 *   mousedown 进入拖拽态，mousemove 改变对应 <col> 的 width，mouseup 退出.
 *
 * 用法：
 *   <ResizableTable
 *     columns={[
 *       { key: 'change', label: 'Change', width: 96, minWidth: 60, maxWidth: 200 },
 *       { key: 'date', label: 'Date', width: 160 },
 *       { key: 'desc', label: 'Description', width: 320 },
 *     ]}
 *     rows={[{ change: '2137156', date: '...', desc: '...' }]}
 *     renderCell={(row, col) => row[col.key]}
 *   />
 *
 * 状态：列宽由本组件自管，外部可通过 onColumnsChange 持久化（可选）.
 *   最低列宽 40px，防止拖到 0 看不见；表头单元格 overflow:hidden 防止内容撑宽.
 */

export interface ResizableColumn {
  key: string
  label: ReactNode
  /** 初始/默认宽度（px） */
  width: number
  minWidth?: number
  maxWidth?: number
  align?: 'left' | 'right' | 'center'
}

interface ResizableTableProps {
  columns: ResizableColumn[]
  rows: Record<string, ReactNode>[]
  /** 斑马纹：奇偶行交替底色 */
  zebra?: boolean
  /** 可点击行回调；传入则行变为 hover 高亮 + cursor-pointer */
  onRowClick?: (rowIndex: number) => void
  /** 当前选中行索引（高亮） */
  selectedRowIndex?: number
  /** 空数据提示 */
  emptyText?: string
  /** 列宽变化回调（用于外部持久化） */
  onColumnsChange?: (columns: ResizableColumn[]) => void
}

const DEFAULT_MIN = 40
const DEFAULT_MAX = 800

export function ResizableTable({
  columns: initialColumns,
  rows,
  zebra = false,
  onRowClick,
  selectedRowIndex,
  emptyText = '没有数据',
  onColumnsChange,
}: ResizableTableProps) {
  const [columns, setColumns] = useState<ResizableColumn[]>(initialColumns)
  const [dragging, setDragging] = useState<{ index: number; startX: number; startWidth: number } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  // 外部 columns 变化时重置（如切换数据源）；拖拽态不重置避免抖动
  useEffect(() => {
    setColumns(initialColumns)
  }, [initialColumns])

  const startDrag = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    const col = columns[index]
    setDragging({
      index,
      startX: e.clientX,
      startWidth: col.width,
    })
  }, [columns])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragging.startX
      const col = columns[dragging.index]
      const min = col.minWidth ?? DEFAULT_MIN
      const max = col.maxWidth ?? DEFAULT_MAX
      const next = Math.min(max, Math.max(min, dragging.startWidth + dx))
      setColumns((prev) => {
        const copy = prev.slice()
        copy[dragging.index] = { ...copy[dragging.index], width: next }
        return copy
      })
    }
    const onUp = () => {
      setDragging(null)
      // 通知外部持久化最新列宽
      if (onColumnsChange) {
        setColumns((cur) => {
          onColumnsChange(cur)
          return cur
        })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // 拖拽时给 body 加 cursor:col-resize，避免鼠标移到窄手柄外丢失指针样式
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, columns, onColumnsChange])

  if (rows.length === 0) {
    return <div className="text-xs text-foreground-tertiary py-2">{emptyText}</div>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table ref={tableRef} className="min-w-full text-[12px] border-collapse">
        <colgroup>
          {columns.map((col) => (
            <col key={col.key} style={{ width: col.width }} />
          ))}
        </colgroup>
        <thead className="bg-surface-header">
          <tr className="text-left text-foreground-secondary">
            {columns.map((col, i) => (
              <th
                key={col.key}
                className={`relative px-2 py-1.5 font-medium overflow-hidden ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                style={{ width: col.width }}
              >
                <span className="block truncate" title={typeof col.label === 'string' ? col.label : undefined}>
                  {col.label}
                </span>
                {/* 拖拽手柄：th 右边缘 4px 宽热区，hover 时显示 col-resize + 深色竖线 */}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`调整 ${typeof col.label === 'string' ? col.label : col.key} 列宽`}
                  onMouseDown={(e) => startDrag(e, i)}
                  className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-primary/40 transition-colors"
                  style={{ transform: 'translateX(2px)' }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isSelected = selectedRowIndex === ri
            const isZebraEven = zebra && ri % 2 === 1
            return (
              <tr
                key={ri}
                onClick={onRowClick ? () => onRowClick(ri) : undefined}
                className={`border-t border-border-subtle align-top ${
                  isSelected
                    ? 'bg-surface-active'
                    : isZebraEven
                      ? 'bg-surface-2'
                      : 'bg-surface-1'
                } ${onRowClick ? 'cursor-pointer hover:bg-surface-hover' : ''}`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-2 py-1.5 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                  >
                    {row[col.key] ?? ''}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
