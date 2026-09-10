import { describe, expect, it } from 'vitest'
// 与既有测试一致：vitest 未配置 @/ 别名，用相对路径引用
import { normalizeViewMode, QUICK_DIRS_VIEW_KEY } from '../src/services/uiPreferences'

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
  })
})
