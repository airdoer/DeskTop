import type { SVGProps } from 'react'

/*
 * C7 DeskTop Icon System
 * 依据 docs/UI_DESIGN_SYSTEM.md §14：整个项目仅使用一套 Icon System。
 * 默认线性图标：1.5px stroke、24x24 viewBox、currentColor、无填充。
 * 参考 Fluent System Icons / Tabler Icons 的克制线性风格。
 *
 * 实心图标（solid）：以 fill="currentColor" 为主，用于面板标题等需要高辨识度的场景，
 *   视觉权重高于线性图标，避免在小尺寸下显得单薄看不清。
 */

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number
}

function base({ size = 16, strokeWidth = 1.5, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  }
}

/**
 * 实心图标基座：fill="currentColor" 默认不设 stroke，
 * 需要描边的子元素（如版本控制图标的连接线）在内部显式声明。
 */
function solidBase({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    ...rest,
  }
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12.5 11.4 6.2a1 1 0 0 1 1.4 0L19 12.5" />
      <path d="M7 11v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-7" />
      <path d="M10 19v-5h4v5" />
    </svg>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .33 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.33 1.7 1.7 0 0 0-1 1.56V20a2 2 0 1 1-4 0v-.08a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .33-1.87 1.7 1.7 0 0 0-1.56-1H4a2 2 0 1 1 0-4h.08a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.33-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.33H10.5a1.7 1.7 0 0 0 1-1.56V4a2 2 0 1 1 4 0v.08a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.33 1.87V10.5a1.7 1.7 0 0 0 1.56 1H20a2 2 0 1 1 0 4h-.08a1.7 1.7 0 0 0-1.52 1Z" />
    </svg>
  )
}

export function ToolsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14.7 6.3a4 4 0 0 1-5.6 5.6l-4.2 4.2a2 2 0 1 0 2.8 2.8l4.2-4.2a4 4 0 0 1 5.6-5.6l-2.4 2.4-2-2 2.4-2.4Z" />
      <path d="m14 14 5 5" />
    </svg>
  )
}

/**
 * 搜索/放大镜：用于标题栏「搜索或跳转」入口与快捷跳转浮层的输入区。
 * 圆形镜片 + 右下斜向手柄，是最不易与其他图标混淆的通用检索语义。
 */
export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.4 15.4 4.1 4.1" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7a1 1 0 0 1 1-1h4.5a1 1 0 0 1 .7.3L11.5 7.5H19a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
    </svg>
  )
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7a1 1 0 0 1 1-1h4.5a1 1 0 0 1 .7.3L11.5 7.5H19a1 1 0 0 1 1 1V9H4Z" />
      <path d="M3.6 10h17l-1.6 7.2a1 1 0 0 1-1 .8H4.6a1 1 0 0 1-1-.8Z" />
    </svg>
  )
}

export function MonitorIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v4M9 20h6" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h4l10-10-4-4L4 16Z" />
      <path d="m14 6 4 4" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 9a8 8 0 0 1 13.5-3.5L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 15a8 8 0 0 1-13.5 3.5L4 16" />
      <path d="M4 20v-4h4" />
    </svg>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12 5 5L20 7" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function RefreshArrowIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  )
}

/** 路径互转：两条反向箭头，表示本地路径与 P4 路径之间的换算 */
export function SwapIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8h14" />
      <path d="m15 5 3 3-3 3" />
      <path d="M20 16H6" />
      <path d="m9 13-3 3 3 3" />
    </svg>
  )
}

/** 侧边栏收起（内容区向左展开） */
export function SidebarCollapseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
      <path d="m16 10-2.5 2 2.5 2" />
    </svg>
  )
}

/** 侧边栏展开（内容区向右展开） */
export function SidebarExpandIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
      <path d="m13.5 10 2.5 2-2.5 2" />
    </svg>
  )
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function HelpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9.6a2.3 2.3 0 1 1 3.1 2.1c-.6.3-.9.8-.9 1.5v.3" />
      <circle cx="12" cy="17" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ServerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  )
}

export function BranchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="6" r="2" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="9" r="2" />
      <path d="M7 8v8" />
      <path d="M17 11c0 3.5-2.5 4-5 4.2" />
    </svg>
  )
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 5h5v5" />
      <path d="M19 5l-8 8" />
      <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
    </svg>
  )
}

/** 五角星：默认描边；激活时传 fill="currentColor" 变实心 */
export function StarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 4 2.35 4.9 5.15.68-3.8 3.6.95 5.07L12 15.7l-4.65 2.55.95-5.07-3.8-3.6 5.15-.68Z" />
    </svg>
  )
}

/**
 * 地球/站点：用于「常用网站」导航项。
 * 圆形轮廓 + 经线 + 纬线，语义对应内网站点集合。
 */
export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.3 9.2h17.4M3.3 14.8h17.4" />
      <path d="M12 3c2.4 2.6 3.7 5.7 3.7 9s-1.3 6.4-3.7 9c-2.4-2.6-3.7-5.7-3.7-9S9.6 5.6 12 3Z" />
    </svg>
  )
}

/** 眼睛：显示/可见，用于恢复被隐藏的站点 */
export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/** 眼睛加斜线：隐藏，用于隐藏内置站点 */
export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.4 16.4 0 0 1-2.6 3.5" />
      <path d="M6.4 7.8A15.8 15.8 0 0 0 2.5 12S6 18.5 12 18.5c1 0 2-.1 2.9-.4" />
      <path d="M9.6 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M4 4l16 16" />
    </svg>
  )
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  )
}

/* ---------- 实心图标（Solid）---------- */

/**
 * 实心显示器：用于系统信息面板标题。
 * 屏幕主体为实心圆角矩形 + 底部支架与底座，在 14px 小尺寸下仍清晰可辨。
 */
export function MonitorSolidIcon(props: IconProps) {
  return (
    <svg {...solidBase(props)}>
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z" />
      <rect x="9" y="18" width="6" height="2" rx="0.5" />
      <rect x="7" y="20.5" width="10" height="1.5" rx="0.75" />
    </svg>
  )
}

/**
 * 实心文件夹：用于常用目录面板标题。
 * 与 FolderIcon 同形，但以 fill 呈现，搭配文件夹黄在浅底上更醒目。
 */
export function FolderSolidIcon(props: IconProps) {
  return (
    <svg {...solidBase(props)}>
      <path d="M4 7a1 1 0 0 1 1-1h4.5a1 1 0 0 1 .7.3L11.5 7.5H19a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
    </svg>
  )
}

/**
 * 版本控制分支：用于 P4 工作区面板标题。
 * 三个实心提交节点 + 连接分支线，语义对应 Perforce 的 changelist / branch 视图，
 * 视觉参考 Font Awesome solid code-branch，适配 24x24 viewBox。
 */
export function VersionControlIcon(props: IconProps) {
  return (
    <svg {...solidBase(props)}>
      <path
        d="M12 16.5V11.5C12 9.5 9 7.5 6 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M12 11.5C12 9.5 15 7.5 18 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="12" cy="19" r="2.5" />
    </svg>
  )
}

/**
 * 在 P4V 中打开：外框 GUI 窗口 + 内嵌版本控制节点，
 * 语义为「把此 workspace 在 P4V 图形客户端中打开」。
 * 与 VersionControlIcon 共享节点形语言，但加窗框以区分「打开动作」与「面板归属」。
 */
export function P4VWindowIcon(props: IconProps) {
  return (
    <svg {...solidBase(props)}>
      <path d="M3 5.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-13Z" />
      <rect x="3" y="5" width="18" height="2.5" rx="0.5" fill="var(--color-surface-1, #fff)" />
      <circle cx="10.5" cy="14.5" r="1.8" fill="var(--color-surface-1, #fff)" />
      <circle cx="15.5" cy="11" r="1.8" fill="var(--color-surface-1, #fff)" />
      <path
        d="M10.5 14.5V12.5C10.5 11 11.5 10 13 10"
        fill="none"
        stroke="var(--color-surface-1, #fff)"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 实心地球：用于「常用网站」面板标题。
 * 球体实心 + 经线/纬线以底色镂空（与 P4VWindowIcon 同一套「实心 + 底色反白」语言），
 * 在 14px 小尺寸下仍可辨识。
 */
export function GlobeSolidIcon(props: IconProps) {
  return (
    <svg {...solidBase(props)}>
      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
      <path
        d="M12 3c2.4 2.6 3.7 5.7 3.7 9s-1.3 6.4-3.7 9c-2.4-2.6-3.7-5.7-3.7-9S9.6 5.6 12 3Z"
        fill="var(--color-surface-1, #fff)"
      />
      <path
        d="M3.4 9.2h17.2M3.4 14.8h17.2"
        fill="none"
        stroke="var(--color-surface-1, #fff)"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 实心工单/票据：用于 Redmine 面板标题。
 * 圆角矩形票据 + 顶部两条分隔线 + 左侧状态孔，语义对应 Redmine issue 票据，
 * 视觉参考 Redmine 官方 logo 的红色票据感，适配 24x24 viewBox。
 */
export function TicketSolidIcon(props: IconProps) {
  return (
    <svg {...solidBase(props)}>
      <path d="M4 5.5a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 5.5v2a1 1 0 0 0 0 2v5a1 1 0 0 0 0 2v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-2a1 1 0 0 0 0-2v-5a1 1 0 0 0 0-2Z" />
      <rect x="9.5" y="5.5" width="1.6" height="13" rx="0.4" fill="var(--color-surface-1, #fff)" />
    </svg>
  )
}

/* ---------- 窗口控制 + 用户图标 ---------- */

/**
 * 用户头像/登录：圆形头部 + 弧形肩部，用于标题栏「登录用户」按钮.
 * 线性图标，1.5px stroke，与 Icon System 默认风格一致。
 */
export function UserIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  )
}

/**
 * 退出登录：矩形门框 + 向右箭头，用于「登录用户」下拉菜单的登出项.
 * 与 ExternalLinkIcon 的箭头方向语言一致，区分「进入」与「离开」。
 */
export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M16 16 20 12 16 8" />
      <path d="M20 12H9" />
    </svg>
  )
}

/**
 * 最小化：一条水平线，对应 Windows 标题栏最小化按钮符号.
 * 放在标题栏按钮区，使用 10px 小尺寸以与 36px 高度的按钮单元格视觉对齐。
 */
export function MinimizeIcon(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 1.8, ...props })}>
      <path d="M5 12h14" />
    </svg>
  )
}

/**
 * 最大化：方框外框，对应 Windows 标题栏最大化按钮符号.
 */
export function MaximizeIcon(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 1.5, ...props })}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="1" />
    </svg>
  )
}

/**
 * 还原（最大化后）：两个错位方框，表示「从最大化还原」.
 * 与 MaximizeIcon 互斥显示，由渲染层根据主窗口最大化状态切换。
 */
export function RestoreIcon(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 1.5, ...props })}>
      <rect x="5" y="9" width="10" height="10" rx="1" />
      <path d="M9 9V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
    </svg>
  )
}
