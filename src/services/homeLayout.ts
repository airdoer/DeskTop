/*
 * homeLayout Service — 主页「可拼装布局」的纯逻辑.
 *
 * 主页是用户自选的组件组合：可添加、删除、拖动排序。布局本身只是一串组件 id，
 *   因此持久化用 uiPreferences 的字符串偏好（逗号分隔）即可，无需新增 IPC 通道或 JSON 文件。
 *
 * 本模块不依赖 React、不感知组件实现——合法 id 由调用方注入（features/home/homeWidgets.tsx），
 *   因此可被单测直接覆盖（见 test/home-layout.test.ts）。
 */

/** 布局串的分隔符：组件 id 均为 `[a-z-]`，逗号不会与 id 冲突 */
const SEPARATOR = ','

/**
 * 解析持久化的布局串。
 * 容错规则（脏数据不应让主页白屏）：
 *   - 非字符串（含 undefined，即从未配置过）→ 回退默认布局；
 *   - 丢弃未知 id、空片段与重复项，保持原有顺序；
 *   - 已配置但解析结果为空 → **返回空数组**：用户可能主动删光了全部组件，
 *     此时应尊重其选择并展示空状态，而不是把默认布局又塞回去。
 */
export function parseHomeLayout(
  raw: unknown,
  validIds: readonly string[],
  fallback: readonly string[],
): string[] {
  if (typeof raw !== 'string') return [...fallback]

  const valid = new Set(validIds)
  const seen = new Set<string>()
  const ids: string[] = []
  for (const token of raw.split(SEPARATOR)) {
    const id = token.trim()
    if (!id || !valid.has(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** 序列化布局：空布局写成空串（区别于 undefined 的「从未配置」） */
export function serializeHomeLayout(ids: readonly string[]): string {
  return ids.join(SEPARATOR)
}

/** 追加一个组件到末尾；已存在则原样返回（避免重复添加同一组件） */
export function addHomeWidget(ids: readonly string[], id: string): string[] {
  if (!id || ids.includes(id)) return [...ids]
  return [...ids, id]
}

/** 移除一个组件；不存在则原样返回 */
export function removeHomeWidget(ids: readonly string[], id: string): string[] {
  return ids.filter((item) => item !== id)
}

/** 尚未添加的组件（按注册表顺序），用于「添加组件」菜单 */
export function availableHomeWidgets(
  ids: readonly string[],
  allIds: readonly string[],
): string[] {
  const used = new Set(ids)
  return allIds.filter((id) => !used.has(id))
}
