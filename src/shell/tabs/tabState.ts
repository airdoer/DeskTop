import type { RouteId } from '@/shell/navigation'
import { MAX_CLOSED_STACK, type Tab, type TabManagerState } from './tabTypes'

/*
 * Tab 状态管理的纯逻辑模块.
 *
 * 所有 tab 操作（创建、关闭、切换、重排、恢复、批量关闭）均以纯函数实现：
 *   - 输入 prev state + 参数，输出 next state（不可变更新）
 *   - 不依赖 React，可被单测直接覆盖（见 test/tab-state.test.ts）
 *   - 边界条件（关闭最后一个 tab、恢复空栈、重排越界等）在此处统一处理
 *
 * 核心语义约定：
 *   - 「在当前 tab 打开」= 替换当前 tab 的 routeId（并清空 state），不新增 tab；
 *   - 「在新 tab 打开」= 在激活 tab 之后追加新 tab，并切换激活；
 *   - 关闭最后一个 tab 时，自动补一个 home tab（保证总有至少一个 tab）；
 *   - 关闭时把当前 state 一起塞进 closedStack，Ctrl+Shift+T 恢复时还原；
 *   - 在当前 tab 内导航到不同 routeId 时，清空 state（state 跟随 routeId，
 *     跨路由不保留——与浏览器 tab 内导航行为一致）。
 */

/** 生成唯一 tab id（时间戳 + 随机后缀，足够单进程内唯一） */
export function createTabId(): string {
  // performance.now 在 Electron 渲染进程可用，且单调递增；
  // 配合 Math.random 防止同一毫秒内多次调用碰撞
  const ts = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return `tab-${ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 创建一个新 tab */
export function createTab(routeId: RouteId, state?: unknown): Tab {
  return { id: createTabId(), routeId, state }
}

/** 初始状态：单 tab 指向 defaultRoute */
export function createInitialTabState(defaultRoute: RouteId): TabManagerState {
  const initialTab = createTab(defaultRoute)
  return {
    tabs: [initialTab],
    activeTabId: initialTab.id,
    closedStack: [],
  }
}

/** 找到激活 tab；若激活 id 无效（脏数据）则回退第一个 tab */
export function findActiveTab(state: TabManagerState): Tab | undefined {
  const active = state.tabs.find((t) => t.id === state.activeTabId)
  return active ?? state.tabs[0]
}

/**
 * 在当前 tab 内导航到 routeId.
 * - 若新 routeId 与当前相同，仅更新激活（保持 state 不变）；
 * - 若不同，替换 routeId 并清空 state（跨路由不保留已选元素）。
 */
export function navigateInActiveTab(
  state: TabManagerState,
  routeId: RouteId,
): TabManagerState {
  const active = findActiveTab(state)
  if (!active) {
    // 异常情况（无 tab）：直接新建一个
    const fresh = createInitialTabState(routeId)
    return fresh
  }
  if (active.routeId === routeId) {
    // 同路由：仅确保激活，state 保留
    if (state.activeTabId === active.id) return state
    return { ...state, activeTabId: active.id }
  }
  // 跨路由：替换 routeId 并清空 state
  const tabs = state.tabs.map((t) =>
    t.id === active.id ? { ...t, routeId, state: undefined } : t,
  )
  return { ...state, tabs, activeTabId: active.id }
}

/**
 * 在新 tab 打开 routeId.
 * - 新 tab 插入到激活 tab 之后（视觉上「在当前 tab 右侧」），并设为激活。
 * - 若 state 提供（如从 closedStack 恢复），直接带上。
 */
export function openInNewTab(
  state: TabManagerState,
  routeId: RouteId,
  state_?: unknown,
): TabManagerState {
  const activeIndex = state.tabs.findIndex((t) => t.id === state.activeTabId)
  const newTab = createTab(routeId, state_)
  const insertAt = activeIndex >= 0 ? activeIndex + 1 : state.tabs.length
  const tabs = [
    ...state.tabs.slice(0, insertAt),
    newTab,
    ...state.tabs.slice(insertAt),
  ]
  return { ...state, tabs, activeTabId: newTab.id }
}

/**
 * 切换激活到指定 tab id.
 * 若 id 不在列表中（已关闭），返回原 state.
 */
export function setActiveTab(state: TabManagerState, tabId: string): TabManagerState {
  if (!state.tabs.some((t) => t.id === tabId)) return state
  if (state.activeTabId === tabId) return state
  return { ...state, activeTabId: tabId }
}

/**
 * 关闭指定 tab.
 * - 把关闭的 tab（含当前 state）压入 closedStack 顶（超出 MAX 截断）。
 * - 若关闭的是激活 tab，激活迁移到「下一个」tab，没有则「上一个」。
 * - 若关闭后没有任何 tab，补一个 home tab（保证总有至少一个 tab）。
 */
export function closeTab(
  state: TabManagerState,
  tabId: string,
  fallbackRoute: RouteId = 'home',
): TabManagerState {
  const target = state.tabs.find((t) => t.id === tabId)
  if (!target) return state

  const remainingTabs = state.tabs.filter((t) => t.id !== tabId)

  // 压栈：含当前 state（若 state 是 undefined 也照压，恢复时按默认走）
  const closedStack = [target, ...state.closedStack].slice(0, MAX_CLOSED_STACK)

  // 关闭后无 tab，补一个 home
  if (remainingTabs.length === 0) {
    const homeTab = createTab(fallbackRoute)
    return {
      tabs: [homeTab],
      activeTabId: homeTab.id,
      closedStack,
    }
  }

  // 激活迁移：若关的不是激活 tab，激活不变；否则优先切到「下一个」，没有则「上一个」
  let activeTabId = state.activeTabId
  if (tabId === state.activeTabId) {
    const closedIndex = state.tabs.findIndex((t) => t.id === tabId)
    const next = remainingTabs[Math.min(closedIndex, remainingTabs.length - 1)]
    activeTabId = next.id
  }

  return {
    tabs: remainingTabs,
    activeTabId,
    closedStack,
  }
}

/**
 * 恢复最近关闭的 tab（Ctrl+Shift+T）.
 * 从 closedStack 栈顶弹出一个 tab，重新插回 tab 列表（追加到末尾），并设为激活。
 * 栈空时返回原 state（无操作）。
 */
export function reopenLastClosedTab(state: TabManagerState): TabManagerState {
  if (state.closedStack.length === 0) return state
  const [restored, ...rest] = state.closedStack
  // 重新生成 id 以避免与现有 tab id 冲突（原 id 可能在关闭后又被其他操作复用）
  const newTab: Tab = { ...restored, id: createTabId() }
  const tabs = [...state.tabs, newTab]
  return {
    tabs,
    activeTabId: newTab.id,
    closedStack: rest,
  }
}

/**
 * 循环切换激活 tab（Ctrl+Tab / Ctrl+Shift+Tab / 滚轮）.
 * - step > 0 向右（下一个），step < 0 向左（上一个）；
 * - 到达边界时回绕：最后一个 → 第一个，第一个 → 最后一个；
 * - 只有 0 或 1 个 tab 时无操作；激活 id 无效时无操作。
 *
 * 用模运算实现 wrap-around：((i + step) % len + len) % len 把负数也折回正区间。
 */
export function cycleActiveTab(state: TabManagerState, step: number): TabManagerState {
  const len = state.tabs.length
  if (len <= 1) return state
  const currentIndex = state.tabs.findIndex((t) => t.id === state.activeTabId)
  if (currentIndex < 0) return state
  const nextIndex = ((currentIndex + step) % len + len) % len
  const nextTab = state.tabs[nextIndex]
  if (!nextTab || nextTab.id === state.activeTabId) return state
  return { ...state, activeTabId: nextTab.id }
}

/**
 * 拖拽重排：把 from 索引的 tab 移到 to 索引.
 * 越界或相同索引返回原 state. to 是「插入到这个位置」的语义，
 * 移除 from 后 to 需要在 [0, length-1] 之间。
 */
export function moveTab(
  state: TabManagerState,
  from: number,
  to: number,
): TabManagerState {
  if (from < 0 || from >= state.tabs.length) return state
  if (to < 0 || to >= state.tabs.length) return state
  if (from === to) return state
  const next = [...state.tabs]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return { ...state, tabs: next }
}

/**
 * 批量关闭：关闭索引 closeIndices 指定的所有 tab.
 * 通用实现，被 closeLeft/closeRight/closeOthers/closeAll 复用。
 * 激活迁移规则同 closeTab：若激活被关，优先切到剩余中最靠前的 tab（稳定可预测）。
 */
export function closeTabsAtIndices(
  state: TabManagerState,
  indices: number[],
  fallbackRoute: RouteId = 'home',
): TabManagerState {
  if (indices.length === 0) return state
  const indexSet = new Set(indices)
  const closing = state.tabs.filter((_, i) => indexSet.has(i))
  const remaining = state.tabs.filter((_, i) => !indexSet.has(i))

  // 批量压栈：按原顺序压入（关闭左侧时左侧早压入，关闭右侧时右侧早压入）；
  // 这里不刻意区分压栈顺序，因为用户主要关心「能恢复」，而非恢复顺序。
  const closedStack = [...closing.reverse(), ...state.closedStack].slice(0, MAX_CLOSED_STACK)

  if (remaining.length === 0) {
    const homeTab = createTab(fallbackRoute)
    return { tabs: [homeTab], activeTabId: homeTab.id, closedStack }
  }

  // 激活迁移：若激活被关，切到剩余 tabs 中最靠前的一个
  let activeTabId = state.activeTabId
  if (!remaining.some((t) => t.id === state.activeTabId)) {
    activeTabId = remaining[0].id
  }

  return { tabs: remaining, activeTabId, closedStack }
}

/** 关闭指定 tab 左侧所有 tab */
export function closeTabsToLeft(
  state: TabManagerState,
  tabId: string,
  fallbackRoute: RouteId = 'home',
): TabManagerState {
  const index = state.tabs.findIndex((t) => t.id === tabId)
  if (index <= 0) return state
  const indices = Array.from({ length: index }, (_, i) => i)
  return closeTabsAtIndices(state, indices, fallbackRoute)
}

/** 关闭指定 tab 右侧所有 tab */
export function closeTabsToRight(
  state: TabManagerState,
  tabId: string,
  fallbackRoute: RouteId = 'home',
): TabManagerState {
  const index = state.tabs.findIndex((t) => t.id === tabId)
  if (index < 0 || index >= state.tabs.length - 1) return state
  const indices = Array.from({ length: state.tabs.length - index - 1 }, (_, i) => index + 1 + i)
  return closeTabsAtIndices(state, indices, fallbackRoute)
}

/** 关闭除指定 tab 外的其他所有 tab */
export function closeOtherTabs(
  state: TabManagerState,
  tabId: string,
  fallbackRoute: RouteId = 'home',
): TabManagerState {
  const indices = state.tabs
    .map((t, i) => (t.id === tabId ? -1 : i))
    .filter((i) => i >= 0)
  if (indices.length === 0) return state
  return closeTabsAtIndices(state, indices, fallbackRoute)
}

/** 关闭所有 tab（补一个 home） */
export function closeAllTabs(state: TabManagerState, fallbackRoute: RouteId = 'home'): TabManagerState {
  if (state.tabs.length === 0) return state
  const closedStack = [...state.tabs.slice().reverse(), ...state.closedStack].slice(0, MAX_CLOSED_STACK)
  const homeTab = createTab(fallbackRoute)
  return { tabs: [homeTab], activeTabId: homeTab.id, closedStack }
}

/**
 * 更新指定 tab 的 state（页面经 TabContext 调用）.
 * 找不到 tab 时返回原 state.
 */
export function setTabState(
  state: TabManagerState,
  tabId: string,
  tabState: unknown,
): TabManagerState {
  if (!state.tabs.some((t) => t.id === tabId)) return state
  const tabs = state.tabs.map((t) =>
    t.id === tabId ? { ...t, state: tabState } : t,
  )
  return { ...state, tabs }
}
