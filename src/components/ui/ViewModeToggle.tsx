import { GridIcon, ListIcon } from '@/components/ui/icons'
import type { ViewMode } from '@/services/uiPreferences'

/*
 * ViewModeToggle — 列表 / 卡片视图切换（两个按钮的互斥分段控件）.
 * 依据 docs/UI_DESIGN_SYSTEM.md §7 Compact Desktop Density：7x7（28px）图标按钮。
 * 抽取为公共组件：常用目录与 P4 工作区都需要同一套视图切换交互。
 */

export function ViewModeToggle({
  mode,
  onChange,
  label = '视图模式',
}: {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  label?: string
}) {
  const baseBtn =
    'inline-flex items-center justify-center w-7 h-7 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary'
  const activeCls = 'bg-surface-3 text-primary'
  const inactiveCls = 'text-foreground-tertiary hover:bg-surface-hover hover:text-foreground'
  return (
    <div
      className="inline-flex items-center rounded-md border border-border overflow-hidden"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`${baseBtn} ${mode === 'list' ? activeCls : inactiveCls}`}
        aria-pressed={mode === 'list'}
        title="列表视图"
      >
        <ListIcon size={14} />
      </button>
      <button
        type="button"
        onClick={() => onChange('card')}
        className={`${baseBtn} ${mode === 'card' ? activeCls : inactiveCls}`}
        aria-pressed={mode === 'card'}
        title="卡片视图"
      >
        <GridIcon size={14} />
      </button>
    </div>
  )
}
