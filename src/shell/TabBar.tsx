import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, type IconProps } from '@/components/ui/icons'
import { navLeaf } from '@/shell/navigation'
import type { Tab } from '@/shell/tabs/tabTypes'

/*
 * TabBar — 多 tab 横向导航条（嵌入 TitleBar 左侧）.
 *
 * 设计参考 Chrome 标签栏：
 *   - 紧凑高度（与 TitleBar 36px 同高），单行横向排列；
 *   - 每个 tab 显示「图标 + 标题 + 关闭按钮」；
 *   - 拖拽重排（HTML5 DnD，落点以左侧/右侧 2px 主色竖线提示）；
 *   - 右键弹出 context menu：关闭 / 关闭左侧 / 关闭右侧 / 关闭其他 / 关闭全部；
 *   - 不支持拖出开新窗口（用户明确说明）。
 *
 * 溢出压缩（用户要求的「tab 管理器」语义）：
 *   - 当 tab 自然宽度总和超过容器宽度时，激活 tab 仍保持完整宽度（图标 + 标题 + 关闭），
 *     其余 tab 压缩为「仅图标」窄条，给激活 tab 让出空间；
 *   - 压缩判定用 ResizeObserver 测容器宽度 × tab 数量估算，避免 scrollWidth 反馈式抖振；
 *   - 压缩后非激活 tab 的关闭按钮在 hover 时浮出右上角小圆 x（Chrome 行为）。
 *
 * 滚轮切换（用户要求）：在 tab 栏上滚轮 → 按方向切换 tab.
 *   - 用原生 non-passive wheel 监听，preventDefault 阻止横向滚动；
 *   - 节流 150ms，避免触摸板连续事件连发导致一次滚动跳好几个 tab。
 *
 * 视觉规则（与 UI_DESIGN_SYSTEM 一致）：
 *   - 激活 tab 用 surface-1 实底 + 顶部 3px 图标识别色高亮条，模拟「抬起来」的层次；
 *   - 非激活 tab 透明 + 顶部 2px 灰色细条，hover 用 surface-hover；
 *   - 图标沿用侧边栏识别色（navLeaf），保证 tab 与侧边栏 / 浮层视觉同源。
 *
 * 数据流：TabBar 是受控组件，所有状态由 AppShell 持有，本组件只回调。
 */

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onReorder: (from: number, to: number) => void
  onCloseLeft: (tabId: string) => void
  onCloseRight: (tabId: string) => void
  onCloseOthers: (tabId: string) => void
  onCloseAll: () => void
  /** 循环切换激活 tab（滚轮 / Ctrl+Tab），step > 0 向右、< 0 向左 */
  onCycle: (step: number) => void
}

/*
 * 溢出压缩的宽度估算（px）.
 *   NATURAL：含图标 + 标题 + 关闭按钮的常规 tab 平均宽度（min-w 120 ~ max-w 200，取中位偏保守）
 *   COMPACT：仅图标 tab 的固定宽度（w-9 = 36px，含左右内边距）
 *   HYSTERESIS：退出压缩的滞回余量，避免压缩/自然临界点抖振
 *
 * 判定（滞回，用户要求「不能全部显示才缩」）：
 *   - 未压缩态：实测 scrollWidth > clientWidth → 真放不下了，进入压缩；
 *   - 已压缩态：估算「全部展开自然宽度 + 余量」< clientWidth → 确定放得下，退出压缩.
 * 进入用实测保证「能放下就不缩」，退出用估算 + 余量防止
 *   「压缩→scrollWidth 缩小→退回自然→又溢出」的抖振循环.
 */
const NATURAL_TAB_WIDTH = 150
const COMPACT_HYSTERESIS = 120

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onReorder,
  onCloseLeft,
  onCloseRight,
  onCloseOthers,
  onCloseAll,
  onCycle,
}: TabBarProps) {
  /*
   * dragId 用 ref 同步持有：onDragStart 的 setState 是异步的，
   * 若在 onDragOver 里读 state，首次会读到 null 从而漏掉 preventDefault，
   * drop 事件就不会派发，重排静默失败（与 HomePage 排序同一个坑）。
   */
  const dragIndexRef = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)

  // 溢出压缩：非激活 tab 是否压缩为仅图标
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeTabRef = useRef<HTMLDivElement>(null)
  const [compactInactive, setCompactInactive] = useState(false)
  // ref 同步持有压缩态最新值：滞回判定在 effect 闭包里要读当前态，用 ref 避免反复重建订阅
  const compactRef = useRef(false)
  useEffect(() => {
    compactRef.current = compactInactive
  }, [compactInactive])

  const clearDrag = () => {
    dragIndexRef.current = null
    setDragIndex(null)
    setDropIndex(null)
  }

  // 判断落点在 tab 的左半还是右半，决定插入到 targetIndex 还是 targetIndex+1
  const insertIndexAt = (targetIndex: number, event: ReactDragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientX < rect.left + rect.width / 2 ? targetIndex : targetIndex + 1
  }

  const handleDrop = (targetIndex: number, event: ReactDragEvent<HTMLElement>) => {
    if (dragIndexRef.current === null) return
    event.preventDefault()
    event.stopPropagation()
    const to = insertIndexAt(targetIndex, event)
    const from = dragIndexRef.current
    clearDrag()
    // 修正：拖到 from 右侧时，移除 from 后 to 需要减 1
    const adjustedTo = to > from ? to - 1 : to
    if (adjustedTo === from) return
    onReorder(from, adjustedTo)
  }

  // 关闭 context menu：监听全局点击 / Esc / 滚动 / 失焦
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close, true)
    window.addEventListener('blur', close)
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close, true)
      window.removeEventListener('blur', close)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menu])

  const handleContextMenu = (tabId: string, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, tabId })
  }

  /*
   * 溢出压缩判定（滞回）：
   *   - 未压缩态：实测 scrollWidth > clientWidth → 放不下了，进入压缩；
   *   - 已压缩态：估算「全部展开 + 余量」< clientWidth → 确定放得下，退出压缩.
   * 进入用实测保证「能放下就不缩」（用户要求）；退出用估算 + HYSTERESIS 余量，
   *   防止「压缩 → scrollWidth 缩小 → 退回自然 → 又溢出」的抖振循环.
   * useLayoutEffect 在首帧绘制前测一次，避免先画满再压缩的视觉抖动；
   *   ResizeObserver 跟踪容器宽度变化（窗口拉伸 / sidebar 折叠）。
   * 依赖 tabs.length：tab 增减时重新判定。
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const width = el.clientWidth
      if (width === 0) return
      if (compactRef.current) {
        // 已压缩：判断是否可安全退出（估算展开后 + 余量仍放得下）
        if (tabs.length * NATURAL_TAB_WIDTH + COMPACT_HYSTERESIS < width) {
          setCompactInactive(false)
        }
      } else {
        // 未压缩：实测真的放不下了才压缩
        if (el.scrollWidth > width) {
          setCompactInactive(true)
        }
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [tabs.length])

  /*
   * 激活 tab 切换后自动滚进可视区：Ctrl+Tab / 滚轮切到屏外的 tab 时，
   * 不自动滚的话用户看不到当前 tab，体验断裂。inline:'nearest' 只滚最近的滚动祖先。
   */
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  /*
   * 滚轮切换 tab：原生 non-passive wheel 监听，preventDefault 阻止横向滚动.
   * 节流 150ms：触摸板连续事件一次手势只切 1~2 个，鼠标滚轮一格切一个.
   * deltaY > 0（向下）或 deltaX > 0（向右）→ 下一个 tab；反之 → 上一个.
   * 取 deltaY / deltaX 绝对值较大者为主方向，兼容垂直滚轮与触摸板水平滑动.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let lastSwitch = 0
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const now = performance.now()
      if (now - lastSwitch < 150) return
      const delta =
        Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      if (Math.abs(delta) < 4) return
      onCycle(delta > 0 ? 1 : -1)
      lastSwitch = now
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [onCycle])

  return (
    <div
      className="app-region-drag flex items-stretch h-full min-w-0 flex-1"
      onContextMenu={(e) => {
        // 在空白处右键不弹菜单（避免误触），让浏览器默认行为走
        void e
      }}
    >
      <div
        ref={scrollRef}
        className="tabbar-scroll app-region-no-drag flex items-stretch h-full min-w-0 overflow-x-auto"
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId
          const meta = safeNavLeaf(tab.routeId)
          const Icon = meta.icon
          // 溢出压缩：非激活 tab 缩为仅图标；激活 tab 始终保持完整宽度
          const compact = compactInactive && !active
          return (
            <div
              key={tab.id}
              ref={active ? activeTabRef : undefined}
              draggable
              onDragStart={(e) => {
                dragIndexRef.current = index
                setDragIndex(index)
                // 设 dragImage 避免默认的半透明鬼影太丑（用默认即可，浏览器自管）
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', tab.id)
              }}
              onDragEnd={clearDrag}
              onDragOver={(e) => {
                if (dragIndexRef.current === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropIndex(insertIndexAt(index, e))
              }}
              onDrop={(e) => handleDrop(index, e)}
              onClick={() => onSelect(tab.id)}
              onContextMenu={(e) => handleContextMenu(tab.id, e)}
              title={meta.label}
              className={`group relative flex items-center justify-center h-full cursor-pointer select-none transition-colors ${
                compact
                  ? 'w-9 px-0'
                  : 'gap-1.5 pl-3 pr-2 min-w-[120px] max-w-[200px]'
              } ${
                active
                  ? 'bg-surface-1 text-foreground'
                  : 'bg-transparent text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
              } ${dragIndex === index ? 'opacity-50' : ''}`}
            >
              {/* 顶部识别条：激活时用图标识别色 + 3px 加粗，非激活时灰色 + 2px 细条 */}
              <span
                className={`absolute top-0 left-0 right-0 transition-colors ${
                  active ? 'h-[3px]' : 'h-0.5 bg-border'
                }`}
                style={active ? { backgroundColor: meta.iconColor } : undefined}
                aria-hidden
              />
              {/* 左侧落点提示 */}
              {dropIndex === index && dragIndex !== null && dragIndex !== index && (
                <span
                  className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary z-10"
                  aria-hidden
                />
              )}
              <Icon
                size={13}
                style={{ color: meta.iconColor }}
                className="shrink-0"
                aria-hidden
              />
              {!compact && (
                <>
                  <span className="min-w-0 flex-1 truncate text-[12px] leading-4">
                    {meta.label}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose(tab.id)
                    }}
                    className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded text-foreground-tertiary hover:bg-surface-3 hover:text-foreground transition-colors"
                    title="关闭"
                    aria-label={`关闭 ${meta.label}`}
                  >
                    <CloseIcon size={10} />
                  </button>
                </>
              )}
              {/* 压缩态关闭按钮：hover 时右上角浮出小圆 x（Chrome 行为） */}
              {compact && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(tab.id)
                  }}
                  className="absolute top-0.5 right-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-surface-1/90 text-foreground-tertiary hover:bg-surface-3 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                  title="关闭"
                  aria-label={`关闭 ${meta.label}`}
                >
                  <CloseIcon size={8} />
                </button>
              )}
              {/* 右侧落点提示：拖到当前 tab 右侧（最后一个 tab 或下一个 tab 的左半） */}
              {dropIndex === index + 1 && dragIndex !== null && dragIndex !== index && (
                <span
                  className="absolute right-0 top-1 bottom-1 w-0.5 bg-primary z-10"
                  aria-hidden
                />
              )}
            </div>
          )
        })}
        {/* 末尾落点提示：拖到所有 tab 之后 */}
        {dropIndex === tabs.length && dragIndex !== null && (
          <div className="relative h-full w-px">
            <span
              className="absolute right-0 top-1 bottom-1 w-0.5 bg-primary"
              aria-hidden
            />
          </div>
        )}
      </div>

      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          tabId={menu.tabId}
          tabs={tabs}
          onClose={() => setMenu(null)}
          onCloseTab={(id) => {
            onClose(id)
            setMenu(null)
          }}
          onCloseLeft={(id) => {
            onCloseLeft(id)
            setMenu(null)
          }}
          onCloseRight={(id) => {
            onCloseRight(id)
            setMenu(null)
          }}
          onCloseOthers={(id) => {
            onCloseOthers(id)
            setMenu(null)
          }}
          onCloseAll={() => {
            onCloseAll()
            setMenu(null)
          }}
        />
      )}
    </div>
  )
}

/** navLeaf 抛错时降级为「未配置」文案，避免单个坏 routeId 让整条 TabBar 崩 */
function safeNavLeaf(routeId: Tab['routeId']): { label: string; icon: ComponentType<IconProps>; iconColor: string } {
  try {
    const leaf = navLeaf(routeId)
    return { label: leaf.label, icon: leaf.icon, iconColor: leaf.iconColor }
  } catch {
    return { label: '未配置', icon: CloseIcon, iconColor: '#999999' }
  }
}

/*
 * TabContextMenu — 右键菜单.
 * 用 portal 渲染到 document.body，避免被 TitleBar 的 overflow 裁剪。
 * 简单实现：点击外部 / Esc / 滚动 / 失焦 自动关闭。
 */
interface TabContextMenuProps {
  x: number
  y: number
  tabId: string
  tabs: Tab[]
  onClose: () => void
  onCloseTab: (tabId: string) => void
  onCloseLeft: (tabId: string) => void
  onCloseRight: (tabId: string) => void
  onCloseOthers: (tabId: string) => void
  onCloseAll: () => void
}

function TabContextMenu({
  x,
  y,
  tabId,
  tabs,
  onCloseTab,
  onCloseLeft,
  onCloseRight,
  onCloseOthers,
  onCloseAll,
}: TabContextMenuProps) {
  const index = tabs.findIndex((t) => t.id === tabId)
  const hasLeft = index > 0
  const hasRight = index >= 0 && index < tabs.length - 1
  const hasOthers = tabs.length > 1
  const hasAll = tabs.length > 1

  // 防止菜单超出视口
  const menuWidth = 180
  const menuHeight = 168 // 5 项 * 32px + padding
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8)
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8)

  return createPortal(
    <div
      role="menu"
      aria-label="Tab 操作"
      className="fixed z-[100] min-w-[180px] py-1 bg-surface-1 border border-border rounded-md shadow-[0_8px_24px_-8px_rgba(0,0,0,0.24)] select-none"
      style={{ left: adjustedX, top: adjustedY }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <MenuItem onClick={() => onCloseTab(tabId)}>关闭</MenuItem>
      <MenuItem onClick={() => onCloseLeft(tabId)} disabled={!hasLeft}>
        关闭左侧
      </MenuItem>
      <MenuItem onClick={() => onCloseRight(tabId)} disabled={!hasRight}>
        关闭右侧
      </MenuItem>
      <MenuItem onClick={() => onCloseOthers(tabId)} disabled={!hasOthers}>
        关闭其他
      </MenuItem>
      <Divider />
      <MenuItem onClick={onCloseAll} disabled={!hasAll}>
        关闭全部
      </MenuItem>
    </div>,
    document.body,
  )
}

function MenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center px-3 h-8 text-[13px] text-left transition-colors ${
        disabled
          ? 'text-foreground-quaternary cursor-not-allowed'
          : 'text-foreground hover:bg-surface-hover'
      }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="my-1 h-px bg-border-subtle" />
}
