import { describe, it, expect } from 'vitest'
import {
  deriveDirectoryBadge,
  deriveDirectoryColor,
  DIRECTORY_COLORS,
  moveItem,
  normalizeDirectoryBadge,
  normalizeDirectoryColor,
  resolveDirectoryBadge,
  resolveDirectoryColor,
} from '../src/services/quickDirectories'

/*
 * 常用目录标识（颜色 + ≤2 字母）派生规则测试.
 * 背景：这两个字段是持久化的业务数据，未设置时需要稳定派生（同一目录渲染结果不变），
 * 且必须裁剪到 2 个字符以内，否则会撑破徽标并写入脏数据。
 */

describe('normalizeDirectoryColor', () => {
  it('接受合法 #rrggbb 并统一为小写', () => {
    expect(normalizeDirectoryColor('#1677FF')).toBe('#1677ff')
  })

  it('拒绝非法值，回退为自动派生', () => {
    expect(normalizeDirectoryColor('red')).toBeUndefined()
    expect(normalizeDirectoryColor('#fff')).toBeUndefined()
    expect(normalizeDirectoryColor('')).toBeUndefined()
    expect(normalizeDirectoryColor(undefined)).toBeUndefined()
  })
})

describe('normalizeDirectoryBadge', () => {
  it('裁剪到最多 2 个字符', () => {
    expect(normalizeDirectoryBadge('ABCD')).toBe('AB')
    expect(normalizeDirectoryBadge('  P4  ')).toBe('P4')
  })

  it('空串视为未设置', () => {
    expect(normalizeDirectoryBadge('   ')).toBeUndefined()
  })
})

describe('deriveDirectoryBadge', () => {
  it('多词英文名取前两个词首字母', () => {
    expect(deriveDirectoryBadge('Design Docs')).toBe('DD')
    expect(deriveDirectoryBadge('design_docs')).toBe('DD')
    expect(deriveDirectoryBadge('design-docs')).toBe('DD')
  })

  it('单词英文名取前两个字母数字（统一大写）', () => {
    expect(deriveDirectoryBadge('Design')).toBe('DE')
    expect(deriveDirectoryBadge('MyDocs')).toBe('MY')
  })

  it('中文取首字', () => {
    expect(deriveDirectoryBadge('项目文档')).toBe('项')
  })

  it('空名称返回空串（由调用方回退为文件夹图标）', () => {
    expect(deriveDirectoryBadge('')).toBe('')
  })
})

describe('deriveDirectoryColor', () => {
  it('同一 seed 稳定派生同一颜色', () => {
    expect(deriveDirectoryColor('dir-1')).toBe(deriveDirectoryColor('dir-1'))
  })

  it('派生结果始终落在色板内', () => {
    const values = DIRECTORY_COLORS.map((c) => c.value)
    for (const seed of ['a', 'dir-1', 'dir-2', 'C:\\Users\\demo']) {
      expect(values).toContain(deriveDirectoryColor(seed))
    }
  })
})

describe('normalizeDirectoryBadge 大小写', () => {
  it('保留用户输入的原始大小写（支持小写字母）', () => {
    expect(normalizeDirectoryBadge('ab')).toBe('ab')
    expect(normalizeDirectoryBadge('Ab')).toBe('Ab')
    expect(normalizeDirectoryBadge('aB')).toBe('aB')
  })
})

describe('moveItem（拖动排序）', () => {
  const list = ['A', 'B', 'C', 'D']

  it('下移一位：插入到目标项之后', () => {
    expect(moveItem(list, 0, 2)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('上移一位：插入到目标项之前', () => {
    expect(moveItem(list, 2, 1)).toEqual(['A', 'C', 'B', 'D'])
  })

  it('移到末尾（to 等于长度）', () => {
    expect(moveItem(list, 0, 4)).toEqual(['B', 'C', 'D', 'A'])
  })

  it('移到开头（to 为 0）', () => {
    expect(moveItem(list, 3, 0)).toEqual(['D', 'A', 'B', 'C'])
  })

  it('落到自身位置或非法索引时保持原样', () => {
    expect(moveItem(list, 1, 1)).toEqual(list)
    expect(moveItem(list, 1, 2)).toEqual(list)
    expect(moveItem(list, -1, 0)).toEqual(list)
    expect(moveItem(list, 9, 0)).toEqual(list)
  })

  it('不修改原数组', () => {
    moveItem(list, 0, 3)
    expect(list).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('resolve', () => {
  it('优先使用显式设置，缺失时派生', () => {
    expect(resolveDirectoryColor({ id: 'x', name: 'N', path: 'p', color: '#ff4d4f' })).toBe('#ff4d4f')
    expect(resolveDirectoryColor({ id: 'x', name: 'N', path: 'p' })).toBe(deriveDirectoryColor('x'))
    expect(resolveDirectoryBadge({ id: 'x', name: 'Design Docs', path: 'p' })).toBe('DD')
    expect(resolveDirectoryBadge({ id: 'x', name: 'N', path: 'p', badge: 'P4' })).toBe('P4')
  })
})
