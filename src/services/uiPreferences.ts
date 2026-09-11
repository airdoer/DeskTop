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

/* ---------- 视图模式偏好 ---------- */

export type ViewMode = 'list' | 'card'
/** 历史别名：常用目录视图模式，等价于 ViewMode */
export type QuickDirsViewMode = ViewMode

export const QUICK_DIRS_VIEW_KEY = 'quick-dirs.view'
export const P4_WORKSPACES_VIEW_KEY = 'p4-workspaces.view'
/** 常用网站视图模式 */
export const WEBSITES_VIEW_KEY = 'websites.view'
/** P4 工作区「仅看星标」筛选开关，标量 boolean，经 ui-prefs 持久化 */
export const P4_WORKSPACES_STARRED_FILTER_KEY = 'p4-workspaces.starredFilter'

export function normalizeViewMode(value: unknown): ViewMode {
  return value === 'card' ? 'card' : 'list'
}

/** 通用读取：任意面板的视图偏好都可复用 */
export async function readViewMode(key: string): Promise<ViewMode> {
  try {
    const prefs = await getUiPreferences()
    return normalizeViewMode(prefs[key])
  } catch {
    return 'list'
  }
}

export async function saveViewMode(key: string, mode: ViewMode): Promise<void> {
  try {
    await setUiPreferences({ [key]: normalizeViewMode(mode) })
  } catch {
    /* 持久化失败不影响本次会话内的切换 */
  }
}

export async function readQuickDirsViewMode(): Promise<QuickDirsViewMode> {
  return readViewMode(QUICK_DIRS_VIEW_KEY)
}

export async function saveQuickDirsViewMode(mode: QuickDirsViewMode): Promise<void> {
  return saveViewMode(QUICK_DIRS_VIEW_KEY, mode)
}

/* ---------- P4 工作区「仅看星标」筛选开关 ---------- */

export async function readP4StarredFilter(): Promise<boolean> {
  try {
    const prefs = await getUiPreferences()
    return prefs[P4_WORKSPACES_STARRED_FILTER_KEY] === true
  } catch {
    return false
  }
}

export async function saveP4StarredFilter(value: boolean): Promise<void> {
  try {
    await setUiPreferences({ [P4_WORKSPACES_STARRED_FILTER_KEY]: value })
  } catch {
    /* 持久化失败不影响本次会话内的切换 */
  }
}

/* ---------- 通用布尔偏好 ---------- */

/** 读取任意 boolean 偏好：只有严格 true 才算 true，脏数据回退 false */
export async function readBooleanPref(key: string): Promise<boolean> {
  try {
    const prefs = await getUiPreferences()
    return prefs[key] === true
  } catch {
    return false
  }
}

export async function saveBooleanPref(key: string, value: boolean): Promise<void> {
  try {
    await setUiPreferences({ [key]: value })
  } catch {
    /* 持久化失败不影响本次会话内的切换 */
  }
}

/* ---------- 侧边栏折叠 ---------- */

/** 侧边栏是否收起为图标列（true=收起） */
export const SIDEBAR_COLLAPSED_KEY = 'sidebar.collapsed'

export function readSidebarCollapsed(): Promise<boolean> {
  return readBooleanPref(SIDEBAR_COLLAPSED_KEY)
}

export function saveSidebarCollapsed(value: boolean): Promise<void> {
  return saveBooleanPref(SIDEBAR_COLLAPSED_KEY, value)
}

/* ---------- 面板折叠状态 ---------- */

/** 各面板的折叠状态 key：值 boolean（true=折叠） */
export const PANEL_COLLAPSED_KEYS = {
  systemInfo: 'panel.systemInfo.collapsed',
  quickDirs: 'panel.quickDirs.collapsed',
  p4Workspaces: 'panel.p4Workspaces.collapsed',
  redmineIssues: 'panel.redmineIssues.collapsed',
} as const

export type PanelCollapsedKey = (typeof PANEL_COLLAPSED_KEYS)[keyof typeof PANEL_COLLAPSED_KEYS]

/** 读取单个面板的折叠状态 */
export function readPanelCollapsed(key: PanelCollapsedKey): Promise<boolean> {
  return readBooleanPref(key)
}

/** 写入单个面板的折叠状态 */
export function savePanelCollapsed(key: PanelCollapsedKey, value: boolean): Promise<void> {
  return saveBooleanPref(key, value)
}
