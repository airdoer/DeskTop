import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from 'react'

/*
 * TabContext — 页面读写「已选元素」快照的上下文.
 *
 * 设计动机：用户要求 Ctrl+Shift+T 恢复关闭的 tab 时「额外记录页面中的已选元素」。
 *   不同页面的已选元素形态各异（P4 工作区是选中的 workspace、Redmine 是单号/周过滤、
 *   路径转换是输入路径等），shell 不可能枚举所有形态，故把读写权下放给页面：
 *   - shell 只提供不透明的 state 槽位（见 tabTypes.Tab.state）；
 *   - 页面通过 useTabState<T>() 读取上次保存的状态（用于首帧恢复），
 *     并在状态变化时通过 setTabState 写回（用于关闭时压栈恢复）。
 *
 * 与 Tab 状态的关系：
 *   - TabContext 的 getState 返回当前激活 tab 的 state；
 *   - setTabState 把传入的 state 写入当前激活 tab 的 state 槽位；
 *   - 当 tab 关闭时，tabState.closeTab 会把这个 state 一起塞进 closedStack，
 *     Ctrl+Shift+T 恢复时新 tab 会带上这个 state，页面再次 mount 时从 useTabState 读回。
 *
 * 不在 context 里做防抖或节流：页面侧已经只在状态变化时调用 setTabState，
 *   频率受页面自己控制；shell 侧 setState 是一次轻量 map 更新，开销可忽略。
 */

/** 上下文 API：页面侧只看到「读 + 写」两个方法 */
export interface TabContextApi {
  /** 读取当前 tab 的已选元素快照；首次挂载时返回上次保存的值（用于恢复） */
  getState: <T>() => T | undefined
  /** 写入当前 tab 的已选元素快照；关闭 tab 时会随 tab 一起进 closedStack */
  setState: (state: unknown) => void
}

/** 上下文默认值 null：未挂载在 TabManager 内时使用 useTabState 会拿到 null */
export const TabContext = createContext<TabContextApi | null>(null)

/** 上下文 Provider */
export function TabContextProvider({
  value,
  children,
}: {
  value: TabContextApi
  children: ReactNode
}) {
  return <TabContext.Provider value={value}>{children}</TabContext.Provider>
}

/** Hook：获取上下文 API（页面通常用 useTabState 而非这个） */
export function useTabContext(): TabContextApi | null {
  return useContext(TabContext)
}

/**
 * Hook：读写当前 tab 的已选元素快照.
 *
 * 用法：
 *   const [preserved, setPreserved] = useTabState<{ selectedId: string }>()
 *   const [selectedId, setSelectedId] = useState(preserved?.selectedId ?? '')
 *   useEffect(() => { setPreserved({ selectedId }) }, [selectedId])
 *
 * 返回 [当前快照, 写入函数]：
 *   - 当前快照在每次 render 时取自 tab.state（页面通常只用作 useState 初始化器，
 *     读取一次用于恢复，之后靠自己的本地 state 驱动渲染）；
 *   - 写入函数引用稳定（用 ref 持有最新 api），可安全放入 useEffect deps，
 *     不会因 context value 变化而反复触发 effect。
 *
 * 为什么 setState 要稳定：tab.state 每次写入都会让 AppShell 的 tabContextApi 重算，
 *   进而让 context value 变化、页面 re-render。若 setState 引用也跟着变，
 *   页面的 `useEffect(() => setPreserved(...), [selectedId, setPreserved])` 会反复触发，
 *   形成「写 state → re-render → effect 再写 state」的潜在循环。用 ref 持有最新 api
 *   后，setState 引用恒定，effect 只由 selectedId 变化驱动。
 */
export function useTabState<T>(): [T | undefined, (state: T) => void] {
  const api = useContext(TabContext)
  // 用 ref 持有最新 api：setState 闭包不直接依赖 api，引用可稳定
  const apiRef = useRef(api)
  apiRef.current = api

  const setState = useCallback((state: T) => {
    apiRef.current?.setState(state)
  }, [])

  return [api?.getState<T>(), setState]
}
