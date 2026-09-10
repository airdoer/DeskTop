import { useEffect, useState } from 'react'
import {
  PANEL_COLLAPSED_KEYS,
  type PanelCollapsedKey,
  readPanelCollapsed,
  savePanelCollapsed,
} from '@/services/uiPreferences'

/*
 * usePanelCollapsed — 面板折叠状态的持久化 hook.
 * 首帧用默认值（defaultCollapsed），异步从 Main Process 读回真实值后纠正，
 * 切换时同步落盘，下次打开自动恢复。
 *
 * 用法：
 *   const { collapsed, toggle } = usePanelCollapsed(PANEL_COLLAPSED_KEYS.systemInfo)
 *   <Panel collapsible collapsed={collapsed} onToggleCollapsed={toggle} />
 */
export function usePanelCollapsed(
  key: PanelCollapsedKey,
  defaultCollapsed = false,
): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  useEffect(() => {
    let alive = true
    void readPanelCollapsed(key).then((value) => {
      if (!alive) return
      setCollapsed(value)
    })
    return () => {
      alive = false
    }
  }, [key])

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      void savePanelCollapsed(key, next)
      return next
    })
  }

  return { collapsed, toggle }
}
