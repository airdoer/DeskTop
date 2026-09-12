import { SearchIcon } from '@/components/ui/icons'

/*
 * QuickNavTrigger — 「搜索或跳转」入口（Ctrl+K 唤起 QuickNavPalette）.
 *
 * 位置（用户要求）：放在左侧 Sidebar 的最上面（BrandHeader 下方、主导航上方），
 *   而非右侧主内容区顶部。这是「可发现性」入口：常驻 sidebar，用户一眼能看到.
 *
 * 这是一个「看起来像输入框的按钮」：点击等价于 Ctrl+K，唤起 QuickNavPalette 浮层。
 *   不直接是输入框的原因：浮层是 portal + 全屏遮罩，输入框需要浮层挂载后才能聚焦，
 *   若把输入框放在 sidebar、结果列表放在浮层，会割裂输入与结果的视觉关系；
 *   统一用浮层承载「输入 + 结果」更简单（与原 QuickNavPalette 设计一致）。
 *
 * 形态：
 *   - collapsed=false（sidebar 展开，w-56/224px）：搜索条样式（图标 + 文案 + Ctrl+K 键帽）
 *   - collapsed=true（sidebar 收起，w-14/56px）：纯图标按钮，点击同样唤起浮层
 *     收起态外层 padding 由 Sidebar 控制，本组件只渲染按钮自身.
 */

interface QuickNavTriggerProps {
  onClick: () => void
  /** sidebar 是否收起为图标列；收起时渲染为纯图标按钮 */
  collapsed?: boolean
}

export function QuickNavTrigger({ onClick, collapsed = false }: QuickNavTriggerProps) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="快捷跳转（Ctrl+K）"
        aria-label="快捷跳转"
        aria-keyshortcuts="Control+K"
        className="flex w-full h-8 items-center justify-center rounded-md text-foreground-tertiary transition-colors hover:bg-surface-hover hover:text-foreground-secondary"
      >
        <SearchIcon size={16} aria-hidden />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="快捷跳转（Ctrl+K）"
      aria-label="快捷跳转"
      aria-keyshortcuts="Control+K"
      className="flex w-full h-8 items-center gap-2 rounded-md border border-border-subtle bg-surface-1 px-2.5 text-foreground-tertiary transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground-secondary"
    >
      <SearchIcon size={13} aria-hidden />
      <span className="flex-1 text-left text-[12px] leading-4">搜索或跳转</span>
      <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-sm border border-border bg-surface-3 px-1 text-[10px] font-medium leading-none">
        Ctrl K
      </span>
    </button>
  )
}
