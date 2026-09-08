/*
 * C7 DeskTop Logo — 品牌标识（非 Icon System 的一部分）。
 * 需求要求图标用 "C7" 两个字母。使用紧凑圆角方块 + 居中文字，
 * 遵循桌面应用小圆角原则（radius-md = 6px）。
 */

export type C7LogoProps = {
  size?: number
  className?: string
}

export function C7Logo({ size = 22, className }: C7LogoProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md bg-primary text-white font-semibold select-none ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        letterSpacing: '-0.02em',
        lineHeight: 1,
      }}
      aria-label="C7 DeskTop"
    >
      C7
    </span>
  )
}
