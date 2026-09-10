/*
 * uiPreferences Service — 视图偏好等 UI 状态的持久化.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：Renderer 不做本地 IO，统一经 IPC Service 落到
 *   Main Process 的 userData/ui-preferences.json。
 *
 * 为什么不用 localStorage：生产构建以 file:// 加载页面，该 origin 下的 localStorage
 * 不保证持久化，重启应用后视图偏好会回退默认值。
 */

export type UiPreferenceValue = string | number | boolean
export type UiPreferences = Record<string, UiPreferenceValue>

export async function getUiPreferences(): Promise<UiPreferences> {
  const result = await window.ipcRenderer.invoke('ui-prefs:get')
  return (result as UiPreferences) ?? {}
}

/** 合并写入（Main 侧做键名/类型/长度校验，非法值会被忽略） */
export async function setUiPreferences(patch: UiPreferences): Promise<UiPreferences> {
  const result = await window.ipcRenderer.invoke('ui-prefs:set', patch)
  return (result as UiPreferences) ?? {}
}

/* ---------- 常用目录视图模式 ---------- */

export type QuickDirsViewMode = 'list' | 'card'

export const QUICK_DIRS_VIEW_KEY = 'quick-dirs.view'

export function normalizeViewMode(value: unknown): QuickDirsViewMode {
  return value === 'card' ? 'card' : 'list'
}

export async function readQuickDirsViewMode(): Promise<QuickDirsViewMode> {
  try {
    const prefs = await getUiPreferences()
    return normalizeViewMode(prefs[QUICK_DIRS_VIEW_KEY])
  } catch {
    return 'list'
  }
}

export async function saveQuickDirsViewMode(mode: QuickDirsViewMode): Promise<void> {
  try {
    await setUiPreferences({ [QUICK_DIRS_VIEW_KEY]: normalizeViewMode(mode) })
  } catch {
    /* 持久化失败不影响本次会话内的切换 */
  }
}
