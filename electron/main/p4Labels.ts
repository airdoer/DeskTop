/*
 * P4 工作区徽标（labels）净化逻辑：纯函数，不依赖 Electron / Node IO.
 * 独立成文件以便单元测试（ipc.ts 依赖 electron 模块，无法在 vitest 的 node 环境里直接 import）。
 *
 * 这里把 sanitizeLabelsMap 从 ipc.ts 抽出，确保 MAX_P4_FAVORITES 等常量在编译期可见，
 * 避免再次出现「常量未导入导致 ReferenceError、徽标保存静默失败」的回归。
 */

import { MAX_P4_FAVORITES } from './p4'

/** 合法颜色 #rrggbb */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
/** 徽标字母上限（与渲染层 MAX_BADGE_LENGTH 保持一致） */
const MAX_BADGE_LENGTH = 2
/** client 名长度上限（与 p4.ts 的 MAX_CLIENT_NAME_LENGTH 保持一致） */
const MAX_CLIENT_NAME_LENGTH_FALLBACK = 128

export type WorkspaceLabel = { badge?: string; color?: string }
export type WorkspaceLabels = Record<string, WorkspaceLabel>

/**
 * 净化单个 label：只保留合法 badge（≤2 字符）与 color（#rrggbb），
 * 空对象返回 undefined，由调用方删除键，避免持久化无意义的空条目。
 */
export function sanitizeLabel(raw: unknown): WorkspaceLabel | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as { badge?: unknown; color?: unknown }
  const badge =
    typeof src.badge === 'string' ? src.badge.trim().slice(0, MAX_BADGE_LENGTH) : ''
  const color =
    typeof src.color === 'string' && HEX_COLOR.test(src.color.trim())
      ? src.color.trim().toLowerCase()
      : ''
  const out: WorkspaceLabel = {}
  if (badge.length > 0) out.badge = badge
  if (color.length > 0) out.color = color
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 净化 labels 映射：键用 normalizeFavoriteNames 同款规则截断长度，
 * 值用 sanitizeLabel 过滤；键数量受 MAX_P4_FAVORITES 约束避免无界增长。
 */
export function sanitizeLabelsMap(raw: unknown): WorkspaceLabels {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: WorkspaceLabels = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(result).length >= MAX_P4_FAVORITES) break
    const name = key.trim().slice(0, MAX_CLIENT_NAME_LENGTH_FALLBACK)
    if (!name) continue
    const label = sanitizeLabel(value)
    if (label) result[name] = label
  }
  return result
}
