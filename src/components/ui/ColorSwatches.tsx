import { DIRECTORY_COLORS } from '@/services/quickDirectories'

/*
 * ColorSwatches — 标识色选择器（色板 + 「自动」回退项）.
 * 依据 docs/UI_DESIGN_SYSTEM.md §6/§7：20px 圆形色块、选中态用 ring 而非尺寸变化
 *   （尺寸变化会挤压相邻色块，导致 hover 目标漂移）。
 * 抽取为公共组件：常用目录 / P4 工作区 / 常用网站三处的颜色选择交互一致。
 *
 * value 为 null 表示「自动」——由调用方按业务规则派生颜色（见各 Service 的 derive*）。
 */

export function ColorSwatches({
  value,
  onChange,
  label = '标识颜色',
  autoTitle = '自动（由系统派生）',
}: {
  value: string | null
  onChange: (v: string | null) => void
  /** 无障碍分组名 */
  label?: string
  /** 「自动」按钮的悬浮提示，各面板按业务语义自定义 */
  autoTitle?: string
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        title={autoTitle}
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full border text-[9px] leading-none ${
          value === null
            ? 'border-primary text-primary ring-2 ring-primary/25'
            : 'border-border text-foreground-tertiary hover:border-primary-hover'
        }`}
      >
        A
      </button>
      {DIRECTORY_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          aria-pressed={value === c.value}
          title={`${c.label} ${c.value}`}
          className={`w-5 h-5 rounded-full transition-transform focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary ${
            value === c.value ? 'ring-2 ring-primary/40 scale-110' : 'hover:scale-110'
          }`}
          style={{ backgroundColor: c.value }}
        />
      ))}
    </div>
  )
}
