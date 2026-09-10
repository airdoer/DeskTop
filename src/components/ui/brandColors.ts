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
