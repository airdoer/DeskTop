import type { RouteId } from '@/shell/navigation'

/*
 * Tab 类型定义 — 多 tab 导航的核心数据结构.
 *
 * 设计取舍：每个 tab 持有 routeId + 一份不透明 state（页面已选元素的快照）。
 *   - routeId 决定渲染哪个页面；
 *   - state 由页面自己经 TabContext 读写，shell 不解析其内部结构，
 *     这样不同页面可以保存不同形态的「已选元素」（如选中的工作区、单号、输入路径等），
 *     而不必让 shell 知道每种页面的细节。
 *
 * 为什么 state 是 unknown 而非 generic：tab 列表里不同 tab 的 state 类型不同，
 *   一个 tabs 数组无法表达 Record<tabId, T>，统一为 unknown 后由页面侧自行断言。
 */

/** 单个 tab：routeId 决定页面，state 保存页面已选元素快照（可选） */
export interface Tab {
  /** 唯一 id（生成方式见 tabState.ts 的 createTab），用作 React key */
  id: string
  /** tab 当前承载的路由 */
  routeId: RouteId
  /** 页面已选元素快照；由页面经 TabContext 写入，shell 不解析 */
  state?: unknown
}

/** Tab 管理器状态：当前打开的 tab 列表 + 激活 tab + 最近关闭栈 */
export interface TabManagerState {
  tabs: Tab[]
  activeTabId: string
  /** 最近关闭的 tab 栈（后进先出），Ctrl+Shift+T 从栈顶恢复 */
  closedStack: Tab[]
}

/** 最近关闭 tab 栈的最大长度，避免无限增长 */
export const MAX_CLOSED_STACK = 32

/**
 * tab 标题来源：与侧边栏同源（navLeaf），保证 tab 显示的标题、图标、识别色
 * 与侧边栏页签完全一致。
 */
