import { describe, expect, it } from 'vitest'
import type { RouteId } from '@/shell/navigation'
import {
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsAtIndices,
  closeTabsToLeft,
  closeTabsToRight,
  createInitialTabState,
  createTab,
  createTabId,
  cycleActiveTab,
  findActiveTab,
  moveTab,
  navigateInActiveTab,
  openInNewTab,
  reopenLastClosedTab,
  setActiveTab,
  setTabState,
} from '@/shell/tabs/tabState'
import { MAX_CLOSED_STACK, type TabManagerState } from '@/shell/tabs/tabTypes'

/*
 * Tab 状态管理单测：覆盖创建 / 导航 / 开新 tab / 关闭 / 切换 / 重排 / 恢复 / 批量关闭.
 * 所有操作均为纯函数（输入 prev state + 参数 → 输出 next state），
 *   不依赖 React，可直测；边界条件（关闭最后一个 tab、恢复空栈等）在此锁死。
 *
 * 命名约定：用 'home' / 'redmine' / 'p4-merge' / 'settings' 等真实 RouteId，
 *   与生产数据同源；避免 'a' / 'b' 这类无意义 id 让断言失去语义。
 */

/** 构造一个可控的初始 state：N 个 tab，第一个为激活 */
function makeState(routeIds: RouteId[], activeIndex = 0): TabManagerState {
  const tabs = routeIds.map((id) => createTab(id))
  return {
    tabs,
    activeTabId: tabs[activeIndex]?.id ?? tabs[0]?.id ?? '',
    closedStack: [],
  }
}

/* ---------- 初始化 ---------- */

describe('createInitialTabState', () => {
  it('初始只有一个 tab，激活指向 defaultRoute，closedStack 为空', () => {
    const state = createInitialTabState('home')
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].routeId).toBe('home')
    expect(state.activeTabId).toBe(state.tabs[0].id)
    expect(state.closedStack).toEqual([])
  })

  it('每次调用生成不同的 tab id（避免碰撞）', () => {
    const a = createInitialTabState('home')
    const b = createInitialTabState('home')
    expect(a.tabs[0].id).not.toBe(b.tabs[0].id)
  })
})

/* ---------- findActiveTab ---------- */

describe('findActiveTab', () => {
  it('返回激活 tab', () => {
    const state = makeState(['home', 'redmine'], 1)
    expect(findActiveTab(state)?.routeId).toBe('redmine')
  })

  it('激活 id 无效时回退第一个 tab（脏数据兜底）', () => {
    const state = makeState(['home', 'redmine'], 0)
    const dirty: TabManagerState = { ...state, activeTabId: '不存在的id' }
    expect(findActiveTab(dirty)?.routeId).toBe('home')
  })

  it('tabs 为空时返回 undefined', () => {
    const empty: TabManagerState = { tabs: [], activeTabId: '', closedStack: [] }
    expect(findActiveTab(empty)).toBeUndefined()
  })
})

/* ---------- 在当前 tab 内导航 ---------- */

describe('navigateInActiveTab', () => {
  it('跨路由：替换 routeId 并清空 state', () => {
    const state = makeState(['home'], 0)
    const next = navigateInActiveTab(state, 'redmine')
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0].routeId).toBe('redmine')
    expect(next.tabs[0].state).toBeUndefined()
    expect(next.activeTabId).toBe(next.tabs[0].id)
  })

  it('同路由：保持 state 不变（不重置已选元素）', () => {
    const state = makeState(['redmine'], 0)
    const withState = setTabState(state, state.tabs[0].id, { selected: 'issue-1' })
    const next = navigateInActiveTab(withState, 'redmine')
    expect(next.tabs[0].state).toEqual({ selected: 'issue-1' })
  })

  it('保留其他 tab 不变', () => {
    const state = makeState(['home', 'redmine'], 0)
    const next = navigateInActiveTab(state, 'p4-merge')
    expect(next.tabs[1].routeId).toBe('redmine')
    expect(next.tabs).toHaveLength(2)
  })

  it('tabs 为空时直接新建一个 tab 指向目标路由', () => {
    const empty: TabManagerState = { tabs: [], activeTabId: '', closedStack: [] }
    const next = navigateInActiveTab(empty, 'home')
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0].routeId).toBe('home')
    expect(next.activeTabId).toBe(next.tabs[0].id)
  })
})

/* ---------- 开新 tab ---------- */

describe('openInNewTab', () => {
  it('在激活 tab 之后插入新 tab，并设为激活', () => {
    const state = makeState(['home', 'redmine'], 0)
    const next = openInNewTab(state, 'p4-merge')
    expect(next.tabs).toHaveLength(3)
    expect(next.tabs[1].routeId).toBe('p4-merge')
    expect(next.activeTabId).toBe(next.tabs[1].id)
  })

  it('保留原激活 tab 的状态（不干扰）', () => {
    const state = makeState(['home'], 0)
    const withState = setTabState(state, state.tabs[0].id, { foo: 1 })
    const next = openInNewTab(withState, 'redmine')
    expect(next.tabs[0].state).toEqual({ foo: 1 })
  })

  it('新 tab 可带初始 state（用于从 closedStack 恢复）', () => {
    const state = makeState(['home'], 0)
    const next = openInNewTab(state, 'redmine', { restored: true })
    expect(next.tabs[1].state).toEqual({ restored: true })
  })

  it('激活 id 无效时新 tab 追加到末尾', () => {
    const state = makeState(['home', 'redmine'], 0)
    const dirty: TabManagerState = { ...state, activeTabId: '不存在' }
    const next = openInNewTab(dirty, 'p4-merge')
    expect(next.tabs[2].routeId).toBe('p4-merge')
  })
})

/* ---------- 切换激活 ---------- */

describe('setActiveTab', () => {
  it('切换到指定 tab', () => {
    const state = makeState(['home', 'redmine'], 0)
    const next = setActiveTab(state, state.tabs[1].id)
    expect(next.activeTabId).toBe(state.tabs[1].id)
  })

  it('id 不在列表中时返回原 state（已关闭的 tab 不能激活）', () => {
    const state = makeState(['home', 'redmine'], 0)
    const next = setActiveTab(state, '不存在')
    expect(next).toBe(state)
  })

  it('同 id 不触发更新', () => {
    const state = makeState(['home', 'redmine'], 0)
    const next = setActiveTab(state, state.tabs[0].id)
    expect(next).toBe(state)
  })
})

/* ---------- 关闭 tab ---------- */

describe('closeTab', () => {
  it('关闭非激活 tab：激活不变，被关闭的 tab 进 closedStack', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 1)
    const next = closeTab(state, state.tabs[0].id)
    expect(next.tabs).toHaveLength(2)
    expect(next.tabs[0].routeId).toBe('redmine')
    expect(next.activeTabId).toBe(state.tabs[1].id)
    expect(next.closedStack).toHaveLength(1)
    expect(next.closedStack[0].routeId).toBe('home')
  })

  it('关闭激活 tab：激活迁移到下一个 tab', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    const next = closeTab(state, state.tabs[0].id)
    expect(next.activeTabId).toBe(state.tabs[1].id)
  })

  it('关闭最后一个激活 tab：激活迁移到前一个 tab', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 2)
    const next = closeTab(state, state.tabs[2].id)
    expect(next.activeTabId).toBe(state.tabs[1].id)
  })

  it('关闭唯一 tab：自动补一个 home tab（保证总有至少一个 tab）', () => {
    const state = makeState(['redmine'], 0)
    const next = closeTab(state, state.tabs[0].id, 'home')
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0].routeId).toBe('home')
    expect(next.closedStack).toHaveLength(1)
    expect(next.closedStack[0].routeId).toBe('redmine')
  })

  it('关闭时把 tab 的 state 一起塞进 closedStack（用于 Ctrl+Shift+T 恢复）', () => {
    const state = makeState(['redmine'], 0)
    const withState = setTabState(state, state.tabs[0].id, { selectedIssue: 42 })
    const next = closeTab(withState, state.tabs[0].id, 'home')
    expect(next.closedStack[0].state).toEqual({ selectedIssue: 42 })
  })

  it('关闭不存在的 tab id 返回原 state', () => {
    const state = makeState(['home'], 0)
    const next = closeTab(state, '不存在')
    expect(next).toBe(state)
  })
})

/* ---------- 恢复关闭的 tab（Ctrl+Shift+T） ---------- */

describe('reopenLastClosedTab', () => {
  it('从 closedStack 栈顶弹出，追加到 tab 列表末尾并激活', () => {
    const state = makeState(['home'], 0)
    const closed = closeTab(state, state.tabs[0].id, 'home')
    // 现在 tabs 有一个 home，closedStack 有原 home
    const reopened = reopenLastClosedTab(closed)
    expect(reopened.tabs).toHaveLength(2)
    expect(reopened.tabs[1].routeId).toBe('home')
    expect(reopened.activeTabId).toBe(reopened.tabs[1].id)
    expect(reopened.closedStack).toHaveLength(0)
  })

  it('恢复时还原原 tab 的 state（已选元素一并恢复）', () => {
    const state = makeState(['redmine'], 0)
    const withState = setTabState(state, state.tabs[0].id, { issue: 99 })
    const closed = closeTab(withState, state.tabs[0].id, 'home')
    const reopened = reopenLastClosedTab(closed)
    expect(reopened.tabs[1].state).toEqual({ issue: 99 })
  })

  it('恢复时生成新的 tab id（避免与现有 id 冲突）', () => {
    const state = makeState(['home'], 0)
    const closed = closeTab(state, state.tabs[0].id, 'home')
    const originalId = closed.closedStack[0].id
    const reopened = reopenLastClosedTab(closed)
    expect(reopened.tabs[1].id).not.toBe(originalId)
  })

  it('closedStack 为空时返回原 state（无操作）', () => {
    const state = makeState(['home'], 0)
    const next = reopenLastClosedTab(state)
    expect(next).toBe(state)
  })

  it('按 LIFO 顺序恢复（后关闭的先恢复）', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    const s1 = closeTab(state, state.tabs[1].id) // 关 redmine
    const s2 = closeTab(s1, s1.tabs[1].id) // 关 p4-merge
    // closedStack: [p4-merge, redmine]（后关的在顶）
    const r1 = reopenLastClosedTab(s2)
    expect(r1.tabs[r1.tabs.length - 1].routeId).toBe('p4-merge')
    const r2 = reopenLastClosedTab(r1)
    expect(r2.tabs[r2.tabs.length - 1].routeId).toBe('redmine')
  })
})

/* ---------- 拖拽重排 ---------- */

describe('moveTab', () => {
  it('把 tab 从 from 移到 to', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    const next = moveTab(state, 0, 2)
    expect(next.tabs.map((t) => t.routeId)).toEqual(['redmine', 'p4-merge', 'home'])
  })

  it('向后移动（from > to）', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    const next = moveTab(state, 2, 0)
    expect(next.tabs.map((t) => t.routeId)).toEqual(['p4-merge', 'home', 'redmine'])
  })

  it('相同索引返回原 state', () => {
    const state = makeState(['home', 'redmine'], 0)
    const next = moveTab(state, 0, 0)
    expect(next).toBe(state)
  })

  it('越界索引返回原 state', () => {
    const state = makeState(['home', 'redmine'], 0)
    expect(moveTab(state, -1, 0)).toBe(state)
    expect(moveTab(state, 0, -1)).toBe(state)
    expect(moveTab(state, 0, 99)).toBe(state)
    expect(moveTab(state, 99, 0)).toBe(state)
  })

  it('激活 id 跟随 tab 移动（不因重排丢失激活）', () => {
    const state = makeState(['home', 'redmine'], 0)
    const next = moveTab(state, 0, 1)
    expect(next.activeTabId).toBe(state.tabs[0].id)
    // 激活的还是原 home tab，只是位置变了
    expect(next.tabs[1].id).toBe(state.tabs[0].id)
  })
})

/* ---------- 批量关闭 ---------- */

describe('closeTabsToLeft', () => {
  it('关闭指定 tab 左侧所有 tab', () => {
    const state = makeState(['home', 'redmine', 'p4-merge', 'p4-path'], 2)
    const next = closeTabsToLeft(state, state.tabs[2].id)
    expect(next.tabs.map((t) => t.routeId)).toEqual(['p4-merge', 'p4-path'])
  })

  it('指定 tab 是第一个时无操作', () => {
    const state = makeState(['home', 'redmine'], 0)
    const next = closeTabsToLeft(state, state.tabs[0].id)
    expect(next).toBe(state)
  })

  it('关闭左侧时若激活被关，激活迁移到指定 tab', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    const next = closeTabsToLeft(state, state.tabs[2].id)
    expect(next.activeTabId).toBe(state.tabs[2].id)
  })
})

describe('closeTabsToRight', () => {
  it('关闭指定 tab 右侧所有 tab', () => {
    const state = makeState(['home', 'redmine', 'p4-merge', 'p4-path'], 1)
    const next = closeTabsToRight(state, state.tabs[1].id)
    expect(next.tabs.map((t) => t.routeId)).toEqual(['home', 'redmine'])
  })

  it('指定 tab 是最后一个时无操作', () => {
    const state = makeState(['home', 'redmine'], 1)
    const next = closeTabsToRight(state, state.tabs[1].id)
    expect(next).toBe(state)
  })

  it('关闭右侧时若激活被关，激活迁移到指定 tab', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 2)
    const next = closeTabsToRight(state, state.tabs[0].id)
    expect(next.activeTabId).toBe(state.tabs[0].id)
  })
})

describe('closeOtherTabs', () => {
  it('关闭除指定 tab 外的其他所有 tab', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    const next = closeOtherTabs(state, state.tabs[1].id)
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0].id).toBe(state.tabs[1].id)
    expect(next.activeTabId).toBe(state.tabs[1].id)
  })

  it('只有 1 个 tab 时无操作', () => {
    const state = makeState(['home'], 0)
    const next = closeOtherTabs(state, state.tabs[0].id)
    expect(next).toBe(state)
  })
})

describe('closeAllTabs', () => {
  it('关闭所有 tab，补一个 home', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 1)
    const next = closeAllTabs(state, 'home')
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0].routeId).toBe('home')
    expect(next.activeTabId).toBe(next.tabs[0].id)
    // 原 3 个 tab 全部进 closedStack
    expect(next.closedStack).toHaveLength(3)
  })

  it('tabs 为空时无操作', () => {
    const empty: TabManagerState = { tabs: [], activeTabId: '', closedStack: [] }
    expect(closeAllTabs(empty)).toBe(empty)
  })
})

describe('closeTabsAtIndices', () => {
  it('关闭多个指定索引的 tab', () => {
    const state = makeState(['home', 'redmine', 'p4-merge', 'p4-path'], 0)
    const next = closeTabsAtIndices(state, [0, 2])
    expect(next.tabs.map((t) => t.routeId)).toEqual(['redmine', 'p4-path'])
  })

  it('空索引数组返回原 state', () => {
    const state = makeState(['home'], 0)
    expect(closeTabsAtIndices(state, [])).toBe(state)
  })

  it('关闭所有索引后补一个 home', () => {
    const state = makeState(['redmine'], 0)
    const next = closeTabsAtIndices(state, [0], 'home')
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0].routeId).toBe('home')
  })
})

/* ---------- setTabState ---------- */

describe('setTabState', () => {
  it('更新指定 tab 的 state', () => {
    const state = makeState(['redmine'], 0)
    const next = setTabState(state, state.tabs[0].id, { selectedIssue: 1 })
    expect(next.tabs[0].state).toEqual({ selectedIssue: 1 })
  })

  it('tab 不存在时返回原 state', () => {
    const state = makeState(['home'], 0)
    const next = setTabState(state, '不存在', { foo: 1 })
    expect(next).toBe(state)
  })

  it('不影响其他 tab 的 state', () => {
    const state = makeState(['home', 'redmine'], 0)
    const withRedmine = setTabState(state, state.tabs[1].id, { x: 1 })
    const next = setTabState(withRedmine, withRedmine.tabs[0].id, { y: 2 })
    expect(next.tabs[1].state).toEqual({ x: 1 })
    expect(next.tabs[0].state).toEqual({ y: 2 })
  })
})

/* ---------- 循环切换（Ctrl+Tab / 滚轮） ---------- */

describe('cycleActiveTab', () => {
  it('step=1 向右切换', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    const next = cycleActiveTab(state, 1)
    expect(next.activeTabId).toBe(state.tabs[1].id)
  })

  it('step=-1 向左切换', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 2)
    const next = cycleActiveTab(state, -1)
    expect(next.activeTabId).toBe(state.tabs[1].id)
  })

  it('最后一个 → 第一个（wrap-around）', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 2)
    const next = cycleActiveTab(state, 1)
    expect(next.activeTabId).toBe(state.tabs[0].id)
  })

  it('第一个 → 最后一个（wrap-around 反向）', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    const next = cycleActiveTab(state, -1)
    expect(next.activeTabId).toBe(state.tabs[2].id)
  })

  it('step=2 跨两步切换', () => {
    const state = makeState(['home', 'redmine', 'p4-merge', 'p4-path'], 0)
    const next = cycleActiveTab(state, 2)
    expect(next.activeTabId).toBe(state.tabs[2].id)
  })

  it('step 超过 tab 数时仍正确回绕', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    // step=4，length=3 → (0+4)%3=1
    const next = cycleActiveTab(state, 4)
    expect(next.activeTabId).toBe(state.tabs[1].id)
  })

  it('负 step 超过 tab 数时正确回绕', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    // step=-4，length=3 → ((0-4)%3+3)%3 = (-4%3+3)%3 = (-1+3)%3 = 2
    const next = cycleActiveTab(state, -4)
    expect(next.activeTabId).toBe(state.tabs[2].id)
  })

  it('只有 1 个 tab 时无操作', () => {
    const state = makeState(['home'], 0)
    expect(cycleActiveTab(state, 1)).toBe(state)
    expect(cycleActiveTab(state, -1)).toBe(state)
  })

  it('0 个 tab 时无操作', () => {
    const empty: TabManagerState = { tabs: [], activeTabId: '', closedStack: [] }
    expect(cycleActiveTab(empty, 1)).toBe(empty)
  })

  it('激活 id 无效（不在 tabs 中）时无操作', () => {
    const state = makeState(['home', 'redmine'], 0)
    const dirty: TabManagerState = { ...state, activeTabId: '不存在' }
    expect(cycleActiveTab(dirty, 1)).toBe(dirty)
  })

  it('切到自身时无操作（step 是 length 的整数倍）', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 1)
    // step=3，length=3 → (1+3)%3=1，切到自己
    expect(cycleActiveTab(state, 3)).toBe(state)
  })

  it('不改动 tabs 顺序与 closedStack', () => {
    const state = makeState(['home', 'redmine', 'p4-merge'], 0)
    const next = cycleActiveTab(state, 1)
    expect(next.tabs).toBe(state.tabs)
    expect(next.closedStack).toBe(state.closedStack)
  })
})

/* ---------- closedStack 长度上限 ---------- */

describe('closedStack 长度上限', () => {
  it('超过 MAX_CLOSED_STACK 时截断（栈顶保留最近关闭的）', () => {
    let state = makeState(['home'], 0)
    // 关闭 MAX+5 个 tab，每次都补一个 home 让下一次能关
    for (let i = 0; i < MAX_CLOSED_STACK + 5; i += 1) {
      state = closeTab(state, state.tabs[0].id, 'home')
    }
    expect(state.closedStack).toHaveLength(MAX_CLOSED_STACK)
    // 栈顶是最后一次关闭的（其 routeId 为 home，因为每次都补 home 后又关）
    expect(state.closedStack[0].routeId).toBe('home')
  })
})

/* ---------- createTabId 唯一性 ---------- */

describe('createTabId', () => {
  it('连续调用 100 次生成不同 id', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i += 1) {
      ids.add(createTabId())
    }
    expect(ids.size).toBe(100)
  })
})
