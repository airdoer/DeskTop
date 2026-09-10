/*
 * 常用网站配置的持久化与净化（Main Process 侧纯逻辑，便于单测）.
 *
 * 与 src/services/websites.ts 的关系：Renderer 不能做本地 IO，配置统一落到这里；
 * 两侧的类型与常量需保持一致（见下方 MAX_* 注释），但不允许互相 import。
 *
 * 净化原则（与 quick-dirs 一致）：只接受合法标量，丢弃无法识别的字段，
 * 保证落盘文件始终可被再次安全读取。
 */

export interface WebsiteCustom {
  id: string
  name: string
  url: string
  color?: string
  badge?: string
}

export interface WebsiteConfig {
  /** 显示顺序（站点 id） */
  order: string[]
  /** 被隐藏的站点 id */
  hidden: string[]
  /** 用户自定义站点 */
  custom: WebsiteCustom[]
}

/** 自定义站点上限，与 src/services/websites.ts 的 MAX_CUSTOM_WEBSITES 必须保持一致 */
const MAX_CUSTOM_WEBSITES = 50
/** 徽标文字上限，与 src/services/websites.ts 的 MAX_BADGE_LENGTH 必须保持一致 */
const MAX_BADGE_LENGTH = 2
const MAX_ORDER_LENGTH = 200
const MAX_ID_LENGTH = 64
const MAX_NAME_LENGTH = 40
const MAX_URL_LENGTH = 2048

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * 链接规范化：补全协议并限定 http/https，防止 javascript: 等危险协议进入持久化数据。
 * 与 src/services/websites.ts 的 normalizeWebsiteUrl 等价（主进程无法反向 import 渲染层）。
 */
export function normalizeWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > MAX_URL_LENGTH) return null
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

/** id 列表净化：去空白、去重、限量、限长 */
function sanitizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim().slice(0, MAX_ID_LENGTH)
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= MAX_ORDER_LENGTH) break
  }
  return result
}

function sanitizeCustom(value: unknown): WebsiteCustom[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: WebsiteCustom[] = []
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const url = normalizeWebsiteUrl(item.url)
    // 链接非法则该条目没有意义，直接丢弃
    if (!url) continue
    const id = (typeof item.id === 'string' ? item.id.trim() : '').slice(0, MAX_ID_LENGTH)
    const uniqueId = id && !seen.has(id) ? id : `web-custom-${index}`
    if (seen.has(uniqueId)) continue
    seen.add(uniqueId)

    const entry: WebsiteCustom = {
      id: uniqueId,
      name: (typeof item.name === 'string' ? item.name.trim() : '').slice(0, MAX_NAME_LENGTH) || url,
      url,
    }
    if (typeof item.color === 'string' && HEX_COLOR.test(item.color.trim())) {
      entry.color = item.color.trim().toLowerCase()
    }
    const badge = typeof item.badge === 'string' ? item.badge.trim().slice(0, MAX_BADGE_LENGTH) : ''
    if (badge) entry.badge = badge

    result.push(entry)
    if (result.length >= MAX_CUSTOM_WEBSITES) break
  }
  return result
}

export function sanitizeWebsiteConfig(raw: unknown): WebsiteConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    order: sanitizeIdList(source.order),
    hidden: sanitizeIdList(source.hidden),
    custom: sanitizeCustom(source.custom),
  }
}
