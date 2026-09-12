/*
 * brandColors — 面板标题图标的品牌识别色.
 * 数值来源（2026-09 联网查证）：
 *   - Windows 蓝：Microsoft 官方品牌蓝 / 默认强调色 #0078D4，rgb(0,120,212)
 *   - 文件夹黄：Windows 资源管理器文件夹图标主体色 #F8D775，rgb(248,215,117)
 *     （SchemeColor 收录的 "Windows 10 Folder Yellow" 调色板之 "Shimmery Gold"）
 *   - Perforce 蓝：P4V 客户端蓝色调 #42A2DC，rgb(66,162,220)
 *     （用户指定，取自 P4V / Helix Visual Client 软件图标的蓝色调，
 *      介于 Sky Blue 与品牌蓝之间，比 Perforce 官方 #4C00FF 靛蓝更贴近客户端视觉）
 * 用途：Panel 的 icon 传参时以 style={{ color: X }} 覆盖默认的次级前景色，
 *   仅用于「一眼区分面板归属」，不进入设计 token 体系。
 */

export const WINDOWS_BLUE = '#0078D4'
export const FOLDER_YELLOW = '#F8D775'
export const PERFORCE_BLUE = '#42A2DC'

/** 星标激活色：与文件夹黄同族的琥珀色，浅底上比 FOLDER_YELLOW 更可辨识 */
export const STAR_AMBER = '#F5A623'

/** Redmine 品牌红：Redmine 官方 logo 主色 #E2001A，用于 Redmine 面板标题图标 */
export const REDMINE_RED = '#E2001A'

/** 站点蓝：用于「常用网站」面板标题图标（与色板的「蓝」同值，语义上代表链接/站点） */
export const WEBSITE_BLUE = '#1677FF'

/* ---------- 侧边栏导航识别色 ---------- */

/*
 * 为什么不直接复用上面的品牌色：
 *   上面那些色是给面板标题的**实心**图标用的（14px、fill，底为 surface-header #f0f0f2）；
 *   侧边栏是 16px **线性**图标（1.5px stroke）铺在 surface-sidebar #fafafa 上，
 *   浅色做描边会糊成一片——FOLDER_YELLOW #F8D775 对 #fafafa 的对比度仅约 1.42:1，
 *   肉眼几乎看不见。
 *
 * 因此这里为每个模块提供「同色相、加深到描边可读」的版本，兼顾两点：
 *   1. 与面板标题色同族 —— 用户仍能把「页签」和「面板」对应起来；
 *   2. 对三种底色都 ≥ 3:1 —— WCAG 2.1 非文本对比度下限。
 * 色相之间尽量拉开，保证 8 个页签在 16px 下仍能一眼区分。
 *
 * 约束底色（取自 src/index.css）：#fafafa surface-sidebar（常态）、
 *   #e6f4ff surface-active（激活态）、#f0f0f2 surface-hover（悬停态）。
 *   其中 #e6f4ff 最暗，对比度最低，是真正的约束项——下表左为常态、右为激活态：
 *     home          #6D28D9  6.81 / 6.34   紫（无品牌锚点，与蓝/黄/红都拉开）
 *     systemInfo    #0369A1  5.68 / 5.30   WINDOWS_BLUE #0078D4 加深
 *     quickDirs     #A16207  4.72 / 4.40   FOLDER_YELLOW #F8D775 转为暗金
 *     p4Workspaces  #2E8FCC  3.40 / 3.17   PERFORCE_BLUE #42A2DC 加深
 *     redmine       #E2001A  4.74 / 4.41   REDMINE_RED 原值即达标
 *     websites      #1677FF  3.93 / 3.66   WEBSITE_BLUE 原值即达标
 *     p4Merge       #1F7BB8  4.39 / 4.09   P4 家族深色档
 *     p4Path        #0F8A8A  4.01 / 3.73   青绿
 *     settings      #64748B  4.56 / 4.25   低彩度石板灰，压低视觉权重
 *   数值由 test/nav-colors.test.ts 从 index.css 读取底色后实测并断言，改色值必须同步复核。
 *
 * 关于 quickDirs：琥珀 #D97706 在常态底 #fafafa 上勉强 3.05:1，但落到激活底 #e6f4ff
 *   只剩 2.84:1 而不达标，故再压一档到暗金 #A16207（色相与文件夹黄几乎一致，仅降明度）。
 */
export const NAV_ICON_COLORS = {
  /** 主页：入口/总览。无品牌锚点，取与所有蓝/黄/红都拉开的紫 */
  home: '#6D28D9',
  /** 系统信息：Windows 蓝加深 */
  systemInfo: '#0369A1',
  /** 常用目录：文件夹黄转为暗金 */
  quickDirs: '#A16207',
  /** P4 工作区：P4V 客户端蓝（与 p4merge 同族、明度更高，表示「资源」） */
  p4Workspaces: '#2E8FCC',
  /** Redmine 单子：Redmine 品牌红 */
  redmine: '#E2001A',
  /** 常用网站：链接蓝 */
  websites: '#1677FF',
  /** p4merge：P4 家族深色档（与 P4 工作区同族、明度更低，表示「操作型工具」） */
  p4Merge: '#1F7BB8',
  /** 路径转换：青绿，代表「本地 ↔ P4」之间的映射，与 P4 蓝家族相邻但不重复 */
  p4Path: '#0F8A8A',
  /** 设置：底部工具区，刻意用低彩度石板灰压低视觉权重，不与内容页签争注意力 */
  settings: '#64748B',
} as const
