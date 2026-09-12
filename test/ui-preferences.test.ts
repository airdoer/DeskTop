import { afterEach, describe, expect, it, vi } from 'vitest'
// 与既有测试一致：vitest 未配置 @/ 别名，用相对路径引用
import {
  HOME_LAYOUT_KEY,
  normalizeViewMode,
  QUICK_DIRS_VIEW_KEY,
  readBooleanPref,
  readSidebarCollapsed,
  SIDEBAR_COLLAPSED_KEY,
} from '../src/services/uiPreferences'

describe('normalizeViewMode', () => {
  it('接受合法的两种视图模式', () => {
    expect(normalizeViewMode('list')).toBe('list')
    expect(normalizeViewMode('card')).toBe('card')
  })

  it('非法或缺失值一律回退为 list，避免脏数据导致视图空白', () => {
    expect(normalizeViewMode('grid')).toBe('list')
    expect(normalizeViewMode('')).toBe('list')
    expect(normalizeViewMode(undefined)).toBe('list')
    expect(normalizeViewMode(null)).toBe('list')
    expect(normalizeViewMode(1)).toBe('list')
  })

  it('偏好键名固定，避免与业务数据键冲突', () => {
    expect(QUICK_DIRS_VIEW_KEY).toBe('quick-dirs.view')
    expect(HOME_LAYOUT_KEY).toBe('home.widgets')
  })
})

describe('readBooleanPref', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
    vi.restoreAllMocks()
  })

  /** 伪造渲染进程的 IPC 通道：invoke 返回给定偏好集合（或抛错） */
  function mockInvoke(value: unknown) {
    const invoke = vi.fn(async () => value)
    Object.defineProperty(globalThis, 'window', {
      value: { ipcRenderer: { invoke } },
      configurable: true,
      writable: true,
    })
    return invoke
  }

  it('只有严格 true 才算 true，脏数据回退 false', async () => {
    mockInvoke({ 'sidebar.collapsed': true })
    await expect(readSidebarCollapsed()).resolves.toBe(true)

    mockInvoke({ 'sidebar.collapsed': 'true' })
    await expect(readSidebarCollapsed()).resolves.toBe(false)

    mockInvoke({})
    await expect(readSidebarCollapsed()).resolves.toBe(false)
  })

  it('IPC 失败时回退 false，不影响侧边栏首屏渲染', async () => {
    const invoke = mockInvoke({})
    invoke.mockRejectedValue(new Error('ipc unavailable'))
    await expect(readBooleanPref(SIDEBAR_COLLAPSED_KEY)).resolves.toBe(false)
  })

  it('侧边栏折叠键名固定', () => {
    expect(SIDEBAR_COLLAPSED_KEY).toBe('sidebar.collapsed')
  })
})
