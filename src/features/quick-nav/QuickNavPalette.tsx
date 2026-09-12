import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { SearchIcon } from '@/components/ui/icons'
import { moveActiveIndex, searchQuickNav } from '@/services/quickNav'
import type { QuickNavEntry } from './entries'

/*
 * QuickNavPalette — 全局快捷跳转（Command Palette / Spotlight 风格）.
 * 依据 docs/UI_DESIGN_SYSTEM.md：
 *   §4  Command Palette 属 Application Shell，业务页面不得自行实现（本组件由 AppShell 挂载）
 *   §22 Ctrl+K 唤起 / Esc 关闭 / Enter 确认；↑↓ 选择
 *   §23 结构 = 搜索框 + 结果列表
 *   §7  Compact Density：输入区 40px、结果行 32px
 *   §16 Shadow 允许用于 Dialog/Floating Panel；§1.2 禁止大面积玻璃效果（故遮罩不做 blur）
 *
 * 交互约定（与参考实现 game-watchman/client/src/components/QuickNav.vue 对齐）：
 *   输入关键词 → ↑/↓ 循环选择 → Enter 或点击跳转 → Esc / 点击遮罩关闭。
 *   关闭后清空关键词与选中项，保证下次打开是干净状态。
 *
 * 键盘事件分两处处理：↑/↓/Enter 挂在输入框上（它始终持有焦点），
 *   Esc 挂在 document 上——用户点击结果项后焦点可能落到 body，此时输入框收不到事件。
 */

interface QuickNavPaletteProps {
  open: boolean
  entries: readonly QuickNavEntry[]
  onClose: () => void
  /** 选中某条目（跳转动作由 Shell 负责，本组件不感知路由实现） */
  onSelect: (entry: QuickNavEntry) => void
}

export function QuickNavPalette({ open, entries, onClose, onSelect }: QuickNavPaletteProps) {
  const [keyword, setKeyword] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => searchQuickNav(entries, keyword), [entries, keyword])

  // 打开时清空状态并聚焦输入框；关闭时同样清空，避免下次打开残留上次的关键词
  useEffect(() => {
    if (!open) {
      setKeyword('')
      setActiveIndex(0)
      return
    }
    setKeyword('')
    setActiveIndex(0)
    // portal 首帧挂载后 input 才存在，等一帧再聚焦
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  // 关键词变化后回到第一条，避免选中项停在已消失的位置
  useEffect(() => {
    setActiveIndex(0)
  }, [keyword])

  // 选中项滚动进可视区
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  // Esc 关闭：挂 document，保证焦点不在输入框时也能关闭
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', handleKeyDown, false)
    return () => document.removeEventListener('keydown', handleKeyDown, false)
  }, [open, onClose])

  const commit = useCallback(
    (entry: QuickNavEntry | undefined) => {
      if (!entry) return
      onClose()
      onSelect(entry)
    },
    [onClose, onSelect],
  )

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => moveActiveIndex(current, results.length, 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => moveActiveIndex(current, results.length, -1))
      return
    }
    if (event.key === 'Enter') {
      // 中文输入法确认候选词同样会发出 Enter，此时不应触发跳转
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      commit(results[activeIndex]?.item)
    }
  }

  if (!open) return null

  const isEmpty = results.length === 0

  return createPortal(
    <div className="fixed inset-0 z-50" role="presentation">
      {/* 遮罩：仅压暗，不做 blur（§1.2 禁止大面积玻璃效果） */}
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="快捷跳转"
        className="absolute left-1/2 top-[12vh] flex w-[min(calc(100vw-2rem),560px)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.32)]"
      >
        {/* 搜索输入区（§7：输入高度 32-40px） */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
          <SearchIcon size={15} className="shrink-0 text-foreground-tertiary" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={handleInputKeyDown}
            autoComplete="off"
            spellCheck={false}
            placeholder="输入菜单名称，快速跳转"
            aria-label="搜索菜单"
            aria-controls="quick-nav-list"
            aria-activedescendant={isEmpty ? undefined : optionId(activeIndex)}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-quaternary"
          />
          <Kbd>Esc</Kbd>
        </div>

        {isEmpty ? (
          <div className="px-3 py-8 text-center text-xs text-foreground-tertiary">
            {keyword.trim() ? '未找到匹配的菜单' : '暂无可跳转的菜单'}
          </div>
        ) : (
          /* onMouseDown 阻止默认行为：点击结果项时不把焦点从输入框抢走，↑/↓ 才能继续用 */
          <div
            id="quick-nav-list"
            ref={listRef}
            role="listbox"
            aria-label="跳转目标"
            onMouseDown={(event) => event.preventDefault()}
            className="max-h-[min(50vh,360px)] overflow-y-auto py-1.5"
          >
            {results.map((match, index) => {
              const entry = match.item
              const active = index === activeIndex
              return (
                <div
                  key={entry.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(entry)}
                  className={`flex h-8 cursor-pointer items-center gap-2 px-3 ${
                    active ? 'bg-surface-active' : ''
                  }`}
                >
                  {/* 图标沿用侧边栏的识别色，保证「搜到的条目」与「点进去的页签」对得上号 */}
                  <entry.icon
                    size={15}
                    className="shrink-0"
                    style={{ color: entry.iconColor }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {match.labelSegments.map((segment, segmentIndex) =>
                      segment.hit ? (
                        <span key={segmentIndex} className="font-semibold text-primary">
                          {segment.text}
                        </span>
                      ) : (
                        <span key={segmentIndex}>{segment.text}</span>
                      ),
                    )}
                  </span>
                  {entry.crumb && (
                    <span className="shrink-0 text-[11px] text-foreground-tertiary">
                      {entry.crumb}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 底部操作提示 */}
        <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border-subtle px-3 text-[11px] text-foreground-tertiary">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            选择
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd>
            跳转
          </span>
          <span className="ml-auto">Ctrl + K 唤起</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function optionId(index: number): string {
  return `quick-nav-option-${index}`
}

/** 键帽提示：与「设置」等处的快捷键呈现保持一致的浅底细边样式 */
function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-border border-b-2 bg-surface-3 px-1 font-sans text-[10px] font-medium text-foreground-secondary">
      {children}
    </kbd>
  )
}
