import { describe, it, expect } from 'vitest'
import {
  deriveDirectoryBadge,
  deriveDirectoryColor,
  DIRECTORY_COLORS,
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

describe('resolve', () => {
  it('优先使用显式设置，缺失时派生', () => {
    expect(resolveDirectoryColor({ id: 'x', name: 'N', path: 'p', color: '#ff4d4f' })).toBe('#ff4d4f')
    expect(resolveDirectoryColor({ id: 'x', name: 'N', path: 'p' })).toBe(deriveDirectoryColor('x'))
    expect(resolveDirectoryBadge({ id: 'x', name: 'Design Docs', path: 'p' })).toBe('DD')
    expect(resolveDirectoryBadge({ id: 'x', name: 'N', path: 'p', badge: 'P4' })).toBe('P4')
  })
})
