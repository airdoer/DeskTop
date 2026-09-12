import { navLeaf, type RouteId } from './navigation'

/*
 * NavIcon — 按路由 id 渲染「该页签的图标 + 识别色」。
 *
 * 用途：各功能面板的标题图标（features/* 里的 <Panel icon={...}>）。
 *   面板标题与侧边栏页签共用同一份图标与色值，用户「点哪个页签 → 落到哪个面板」
 *   在视觉上是同一件事；侧边栏换了图标或改了色，面板自动跟随，不存在两处漂移。
 *
 * 放在 shell/ 而非 components/ui/：识别色与图标同源于 shell/navigation，
 *   而 components/ui 是「不认识路由」的纯展示原子层，不应反向依赖 shell。
 *
 * 默认 size=14：与 Panel 标题的 14px 约定一致（docs/UI_DESIGN_SYSTEM.md §14）。
 */

interface NavIconProps {
  id: RouteId
  size?: number
}

export function NavIcon({ id, size = 14 }: NavIconProps) {
  const { icon: Icon, iconColor } = navLeaf(id)
  return <Icon size={size} style={{ color: iconColor }} aria-hidden />
}
