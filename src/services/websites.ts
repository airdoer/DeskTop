/*
 * websites Service — 常用网站的配置读写与打开.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：shell.openExternal 与本地文件 IO 禁止在
 *   Renderer 直接调用，统一经 IPC Service 转发到 Main Process。
 *
 * 数据模型：内置站点（src/features/websites/presets.ts）是只读清单，用户侧只存三样东西：
 *   - order：站点 id 的显示顺序（内置 + 自定义混排）
 *   - hidden：被隐藏的内置站点 id（自定义站点直接删除，不走隐藏）
 *   - custom：用户自定义站点（名称 / 链接 / 颜色 / 徽标）
 * 这样内置清单升级后（新增站点）不会丢用户的隐藏与排序设置，新站点自动追加在末尾。
 */

import { WEBSITE_PRESETS, type WebsitePreset } from '@/features/websites/presets'
import {
  deriveDirectoryBadge,
  deriveDirectoryColor,
  normalizeDirectoryBadge,
  normalizeDirectoryColor,
} from './quickDirectories'

export interface Website {
  id: string
  name: string
  url: string
  /** 标识色 #rrggbb，未设置时按 id 稳定派生 */
  color?: string
  /** 徽标文字，最多 2 个字符，未设置时按名称派生 */
  badge?: string
  /** 是否内置站点：内置项只能隐藏，自定义项可编辑/删除 */
  builtin?: boolean
}

export interface WebsiteConfig {
  /** 显示顺序（站点 id） */
  order: string[]
  /** 被隐藏的站点 id */
  hidden: string[]
  /** 用户自定义站点 */
  custom: Website[]
}

/** 自定义站点上限，与 electron/main/websites.ts 的 MAX_CUSTOM_WEBSITES 必须保持一致 */
export const MAX_CUSTOM_WEBSITES = 50

/** 徽标文字上限（与 electron/main/websites.ts 的 MAX_BADGE_LENGTH 一致） */
export const MAX_BADGE_LENGTH = 2

export const EMPTY_WEBSITE_CONFIG: WebsiteConfig = { order: [], hidden: [], custom: [] }

/**
 * 链接规范化：补全协议、限定 http/https。
 * 非法或空白返回 null（由调用方提示），避免 javascript: 等协议进入持久化数据。
 * 说明：electron/main/websites.ts 有一份等价实现（主进程不允许反向 import 渲染层）。
 */
export function normalizeWebsiteUrl(raw: string): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ? value : `https://${value}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url.toString()
  } catch {
    return null
  }
}

/** 由链接派生默认名称：取主机名（去掉 www. 前缀），失败时回退完整链接 */
export function deriveWebsiteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function resolveWebsiteColor(site: Website): string {
  return normalizeDirectoryColor(site.color) ?? deriveDirectoryColor(site.id || site.url)
}

export function resolveWebsiteBadge(site: Website): string {
  return normalizeDirectoryBadge(site.badge) ?? deriveDirectoryBadge(site.name || site.url)
}

/**
 * 按 order 排序：列表中的 id 按其在 order 中的下标升序，
 * 未出现在 order 中的（新增内置站点 / 新加的自定义站点）保持相对顺序并追加在末尾。
 */
export function sortByOrder(list: readonly Website[], order: readonly string[]): Website[] {
  const rank = new Map<string, number>()
  order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index)
  })
  return list
    .map((item, index) => ({
      item,
      index,
      rank: rank.get(item.id) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item)
}

/**
 * 由配置推导渲染所需的两个列表：可见站点（已排序）与被隐藏的内置站点。
 * 纯函数，便于单测覆盖（见 test/websites.test.ts）。
 */
export function buildWebsiteLists(
  config: WebsiteConfig,
  presets: readonly WebsitePreset[] = WEBSITE_PRESETS,
): { visible: Website[]; hidden: Website[] } {
  const hiddenIds = new Set(config.hidden ?? [])
  const custom = (config.custom ?? []).filter((w) => w && typeof w.id === 'string')
  const all: Website[] = [
    ...presets.map((p): Website => ({ ...p, builtin: true })),
    ...custom.map((c): Website => ({ ...c, builtin: false })),
  ]
  const visible = all.filter((w) => !hiddenIds.has(w.id))
  // 自定义站点删除即移除，不进隐藏区；隐藏区只承载内置站点
  const hidden = all.filter((w) => hiddenIds.has(w.id) && w.builtin)
  return { visible: sortByOrder(visible, config.order ?? []), hidden }
}

/** 拖出显示顺序：把当前可见顺序整体写回 order */
export function orderOf(visible: readonly Website[]): string[] {
  return visible.map((w) => w.id)
}

/** 生成自定义站点 id（与常用目录的 id 风格一致） */
export function genWebsiteId(): string {
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/* ---------- IPC ---------- */

function toConfig(value: unknown): WebsiteConfig {
  const source = (value ?? {}) as Partial<WebsiteConfig>
  return {
    order: Array.isArray(source.order) ? source.order : [],
    hidden: Array.isArray(source.hidden) ? source.hidden : [],
    custom: Array.isArray(source.custom) ? source.custom : [],
  }
}

export async function getWebsiteConfig(): Promise<WebsiteConfig> {
  const result = await window.ipcRenderer.invoke('websites:get')
  return toConfig(result)
}

/** 落盘配置：Main 返回净化后的结果，用它更新 state 保证 UI 与磁盘一致 */
export async function saveWebsiteConfig(config: WebsiteConfig): Promise<WebsiteConfig> {
  const result = await window.ipcRenderer.invoke('websites:set', config)
  return toConfig(result)
}

/** 在系统默认浏览器中打开站点（URL 校验在主进程完成，只放行 http/https） */
export async function openWebsite(url: string): Promise<{ ok: boolean; error?: string }> {
  const result = await window.ipcRenderer.invoke('web:open-external', url)
  return (result as { ok: boolean; error?: string }) ?? { ok: false, error: '无响应' }
}
