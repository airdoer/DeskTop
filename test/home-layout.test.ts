import { describe, expect, it } from 'vitest'
import {
  addHomeWidget,
  availableHomeWidgets,
  parseHomeLayout,
  removeHomeWidget,
  serializeHomeLayout,
} from '@/services/homeLayout'
import { HOME_LAYOUT_KEY } from '@/services/uiPreferences'
import {
  DEFAULT_HOME_LAYOUT,
  HOME_WIDGET_IDS,
  HOME_WIDGETS,
  findHomeWidget,
  type HomeWidgetId,
} from '@/features/home/homeWidgets'
import { collectNavLeaves, FOOTER_NAV_ITEM, NAV_ITEMS } from '@/shell/navigation'

/*
 * 主页「可拼装布局」单测：解析容错（脏数据不能让主页白屏）、增删、可用列表、注册表完整性。
 * 布局串是用户可见状态的唯一载体，解析规则必须锁死。
 */

const ALL = ['system-info', 'quick-dirs', 'p4-workspaces'] as const
const FALLBACK = ['system-info'] as const

describe('parseHomeLayout', () => {
  it('从未配置（undefined / 非字符串）→ 回退默认布局', () => {
    expect(parseHomeLayout(undefined, ALL, FALLBACK)).toEqual(['system-info'])
    expect(parseHomeLayout(null, ALL, FALLBACK)).toEqual(['system-info'])
    expect(parseHomeLayout(42, ALL, FALLBACK)).toEqual(['system-info'])
    expect(parseHomeLayout({ ids: [] }, ALL, FALLBACK)).toEqual(['system-info'])
  })

  it('正常串按原顺序解析', () => {
    expect(parseHomeLayout('p4-workspaces,system-info', ALL, FALLBACK)).toEqual([
      'p4-workspaces',
      'system-info',
    ])
  })

  it('丢弃未知 id（组件下线后不应白屏）', () => {
    expect(parseHomeLayout('system-info,removed-widget,quick-dirs', ALL, FALLBACK)).toEqual([
      'system-info',
      'quick-dirs',
    ])
  })

  it('丢弃重复项与空白片段', () => {
    expect(parseHomeLayout(' system-info , ,system-info,quick-dirs ', ALL, FALLBACK)).toEqual([
      'system-info',
      'quick-dirs',
    ])
  })

  it('已配置但内容全为空 → 返回空布局（尊重用户「删光全部组件」的选择）', () => {
    expect(parseHomeLayout('', ALL, FALLBACK)).toEqual([])
    expect(parseHomeLayout('unknown', ALL, FALLBACK)).toEqual([])
  })

  it('不改写传入的 fallback 数组（调用方的默认布局不能被就地改掉）', () => {
    const fallback = ['system-info']
    const result = parseHomeLayout(undefined, ALL, fallback)
    result.push('quick-dirs')
    expect(fallback).toEqual(['system-info'])
  })
})

describe('serializeHomeLayout', () => {
  it('逗号分隔；空布局序列化为空串（区别于 undefined 的「从未配置」）', () => {
    expect(serializeHomeLayout(['a', 'b'])).toBe('a,b')
    expect(serializeHomeLayout([])).toBe('')
  })

  it('序列化 → 解析可往返', () => {
    const ids = ['quick-dirs', 'p4-workspaces', 'system-info']
    expect(parseHomeLayout(serializeHomeLayout(ids), ALL, FALLBACK)).toEqual(ids)
  })
})

describe('addHomeWidget / removeHomeWidget', () => {
  it('追加到末尾', () => {
    expect(addHomeWidget(['system-info'], 'quick-dirs')).toEqual(['system-info', 'quick-dirs'])
  })

  it('重复添加无效果（同一组件不应出现两次）', () => {
    expect(addHomeWidget(['system-info', 'quick-dirs'], 'system-info')).toEqual([
      'system-info',
      'quick-dirs',
    ])
  })

  it('空 id 不添加', () => {
    expect(addHomeWidget(['system-info'], '')).toEqual(['system-info'])
  })

  it('移除不存在的 id 无效果', () => {
    expect(removeHomeWidget(['system-info'], 'quick-dirs')).toEqual(['system-info'])
  })

  it('可移除到空（允许用户删光全部组件）', () => {
    expect(removeHomeWidget(['system-info'], 'system-info')).toEqual([])
  })

  it('两个操作都不改写原数组', () => {
    const ids = ['system-info']
    addHomeWidget(ids, 'quick-dirs')
    removeHomeWidget(ids, 'system-info')
    expect(ids).toEqual(['system-info'])
  })
})

describe('availableHomeWidgets', () => {
  it('返回尚未添加的组件，保持注册表顺序', () => {
    expect(availableHomeWidgets(['quick-dirs'], ALL)).toEqual(['system-info', 'p4-workspaces'])
  })

  it('全部已添加时返回空（菜单据此显示「全部组件已添加」）', () => {
    expect(availableHomeWidgets([...ALL], ALL)).toEqual([])
  })
})

describe('主页组件注册表', () => {
  it('覆盖全部 HomeWidgetId（漏注册会因类型不完整而在编译期报错）', () => {
    const coverage: Record<HomeWidgetId, boolean> = {
      'system-info': true,
      'quick-dirs': true,
      'p4-workspaces': true,
      redmine: true,
      websites: true,
      'p4-merge': true,
      'p4-path': true,
    }
    for (const id of Object.keys(coverage)) {
      expect(HOME_WIDGET_IDS).toContain(id)
    }
    expect(HOME_WIDGET_IDS.length).toBe(Object.keys(coverage).length)
  })

  it('组件 id 唯一，且都能在注册表里查到', () => {
    expect(new Set(HOME_WIDGET_IDS).size).toBe(HOME_WIDGET_IDS.length)
    for (const id of HOME_WIDGET_IDS) {
      expect(findHomeWidget(id)?.id).toBe(id)
    }
  })

  it('每个组件都有标题与渲染函数', () => {
    for (const widget of HOME_WIDGETS) {
      expect(widget.label.length).toBeGreaterThan(0)
      expect(typeof widget.render).toBe('function')
    }
  })

  it('每个组件都有图标识别色（「添加组件」菜单里靠它认页签）', () => {
    for (const widget of HOME_WIDGETS) {
      expect(widget.iconColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('组件元数据与侧边栏页签逐项同源（标题 / 图标 / 识别色不允许各写一份）', () => {
    const navLeaves = collectNavLeaves(NAV_ITEMS).filter((leaf) => leaf.id !== 'home')
    expect(HOME_WIDGETS.map((w) => [w.id, w.label, w.icon, w.iconColor])).toEqual(
      navLeaves.map((leaf) => [leaf.id, leaf.label, leaf.icon, leaf.iconColor]),
    )
  })

  it('默认布局非空且全部合法（老用户升级后主页不应空白）', () => {
    expect(DEFAULT_HOME_LAYOUT.length).toBeGreaterThan(0)
    for (const id of DEFAULT_HOME_LAYOUT) {
      expect(HOME_WIDGET_IDS).toContain(id)
    }
  })

  it('可拼装组件与侧边栏功能页签同集合（主页能拼的 = 侧边栏能进的）', () => {
    const navRouteIds = NAV_ITEMS.flatMap((item) =>
      item.type === 'leaf' ? [item.id] : item.children.map((child) => child.id),
    ).filter((id) => id !== 'home')
    expect([...HOME_WIDGET_IDS].sort()).toEqual([...navRouteIds].sort())
  })

  it('设置固定在侧边栏底部，不作为可拼装组件', () => {
    expect(FOOTER_NAV_ITEM.id).toBe('settings')
    expect(HOME_WIDGET_IDS).not.toContain('settings')
  })

  it('布局偏好键名固定', () => {
    expect(HOME_LAYOUT_KEY).toBe('home.widgets')
  })
})
