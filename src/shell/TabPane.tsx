import { useMemo, type ReactNode } from 'react'
import { TabContextProvider, type TabContextApi } from './tabs/TabContext'
import type { Tab } from './tabs/tabTypes'

/*
 * TabPane — 单个 tab 的 page 容器，支持 keep-alive.
 *
 * 多 tab 导航的核心：所有打开过的 tab 的 page 同时挂载在 DOM 中，
 *   非激活 tab 用 `hidden`（display:none）隐藏，React 不卸载，本地 state 全部保留
 *   （已选元素、已加载表格、滚动位置、输入内容等）。
 *
 * 与浏览器 tab 行为一致：切换 tab 不触发 page 的 useEffect，数据不重新拉取；
 *   只有「在当前 tab 内导航到不同路由」(navigateInActiveTab 替换 routeId) 或
 *   「关闭 tab」时，对应 page 才卸载。
 *
 * TabContext：每个 TabPane 独立一个 Provider，api 绑定到该 tab 的 state。
 *   页面通过 useTabState<T>() 读到的永远是「自己所属 tab」的 state，互不干扰。
 *   api 用 useMemo 缓存，只在 tab.id / tab.state 变化时重建，避免无谓 re-render。
 *
 * element 用 useMemo 缓存：render 函数引用稳定（pages 是常量），
 *   故 element 引用稳定，切 tab 时不会触发 page re-render（仅 div 的 className 变）。
 *   只有 tab.routeId 变了（navigateInActiveTab 在当前 tab 内换路由），render 变，
 *   element 重建，React 卸载旧 page、挂载新 page——这是期望的（跨路由不保留 state）。
 */

interface TabPaneProps {
  tab: Tab
  active: boolean
  /** page 渲染函数；每个 tab 调用一次，得到独立 React 元素，避免同路由 tab 共享实例 */
  render?: () => ReactNode
  onSetTabState: (tabId: string, state: unknown) => void
}

export function TabPane({ tab, active, render, onSetTabState }: TabPaneProps) {
  const api = useMemo<TabContextApi>(
    () => ({
      getState: <T,>() => tab.state as T | undefined,
      setState: (newState: unknown) => onSetTabState(tab.id, newState),
    }),
    [tab.id, tab.state, onSetTabState],
  )

  // element 缓存：render 稳定时 element 稳定，切 tab 不触发 page re-render
  const element = useMemo(
    () => (render ? render() : <DefaultFallback />),
    [render],
  )

  return (
    <TabContextProvider value={api}>
      <div className={active ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        {element}
      </div>
    </TabContextProvider>
  )
}

function DefaultFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-foreground-tertiary">
      页面未配置
    </div>
  )
}
