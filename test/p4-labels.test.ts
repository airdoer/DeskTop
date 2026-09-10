import { describe, expect, it } from 'vitest'
import { sanitizeLabel, sanitizeLabelsMap } from '../electron/main/p4Labels'

/*
 * P4 工作区徽标净化单元测试.
 * 覆盖 sanitizeLabel（单条 badge/color 净化）与 sanitizeLabelsMap（整体映射净化），
 * 重点回归「MAX_P4_FAVORITES 未导入导致 ReferenceError、徽标保存静默失败」的 bug.
 */

describe('sanitizeLabel', () => {
  it('保留合法 badge 与 color，color 统一小写', () => {
    expect(sanitizeLabel({ badge: 'CM', color: '#FF8800' })).toEqual({
      badge: 'CM',
      color: '#ff8800',
    })
  })

  it('badge 截断到 2 字符并 trim 空白', () => {
    expect(sanitizeLabel({ badge: '  C7M  ' })).toEqual({ badge: 'C7' })
  })

  it('非法 color（非 #rrggbb）被丢弃，合法 badge 保留', () => {
    expect(sanitizeLabel({ badge: 'AB', color: 'red' })).toEqual({ badge: 'AB' })
    expect(sanitizeLabel({ badge: 'AB', color: '#xyz' })).toEqual({ badge: 'AB' })
    expect(sanitizeLabel({ badge: 'AB', color: '#12345' })).toEqual({ badge: 'AB' })
  })

  it('空 badge 与空 color 返回 undefined（调用方删除键）', () => {
    expect(sanitizeLabel({})).toBeUndefined()
    expect(sanitizeLabel({ badge: '   ', color: '' })).toBeUndefined()
  })

  it('非对象输入返回 undefined', () => {
    expect(sanitizeLabel(null)).toBeUndefined()
    expect(sanitizeLabel(undefined)).toBeUndefined()
    expect(sanitizeLabel('CM')).toBeUndefined()
    expect(sanitizeLabel(123)).toBeUndefined()
  })

  it('仅 color 也合法', () => {
    expect(sanitizeLabel({ color: '#00ff00' })).toEqual({ color: '#00ff00' })
  })
})

describe('sanitizeLabelsMap', () => {
  it('净化多条 label，键名 trim 后截断到 128 字符', () => {
    const result = sanitizeLabelsMap({
      '  chenzhixu_C7_Mainline  ': { badge: 'CM', color: '#ff8800' },
      chenzhixu_C7_Online: { badge: 'CO' },
    })
    expect(Object.keys(result)).toHaveLength(2)
    expect(result['chenzhixu_C7_Mainline']).toEqual({ badge: 'CM', color: '#ff8800' })
    expect(result['chenzhixu_C7_Online']).toEqual({ badge: 'CO' })
  })

  it('空 label 被丢弃（不保留无意义的空条目）', () => {
    const result = sanitizeLabelsMap({
      validClient: { badge: 'V' },
      emptyClient: {},
      blankClient: { badge: '   ', color: '' },
    })
    expect(Object.keys(result)).toEqual(['validClient'])
  })

  it('非对象输入返回空映射', () => {
    expect(sanitizeLabelsMap(null)).toEqual({})
    expect(sanitizeLabelsMap(undefined)).toEqual({})
    expect(sanitizeLabelsMap('not a map')).toEqual({})
    expect(sanitizeLabelsMap([])).toEqual({})
  })

  it('空字符串键被跳过', () => {
    const result = sanitizeLabelsMap({
      '   ': { badge: 'X' },
      validClient: { badge: 'V' },
    })
    expect(Object.keys(result)).toEqual(['validClient'])
  })

  /*
   * 关键回归：MAX_P4_FAVORITES 未导入时，此函数会抛 ReferenceError，
   * 导致 IPC p4-workspace-labels:set 静默失败，徽标编辑不生效.
   * 此用例确保函数能正常处理任意输入而不抛运行时错误.
   */
  it('处理单条 label 不抛 ReferenceError（MAX_P4_FAVORITES 已正确导入）', () => {
    expect(() => sanitizeLabelsMap({ someClient: { badge: 'AB' } })).not.toThrow()
    expect(sanitizeLabelsMap({ someClient: { badge: 'AB' } })).toEqual({
      someClient: { badge: 'AB' },
    })
  })

  it('键数量超过上限时截断（MAX_P4_FAVORITES = 50）', () => {
    const raw: Record<string, { badge: string }> = {}
    for (let i = 0; i < 60; i++) raw[`client_${i}`] = { badge: 'AB' }
    const result = sanitizeLabelsMap(raw)
    expect(Object.keys(result)).toHaveLength(50)
  })
})
