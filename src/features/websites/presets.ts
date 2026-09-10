/*
 * 常用网站 — 内置站点清单（唯一数据源）.
 *
 * 内置站点只在这里定义，UI 侧只读：可以隐藏、可以拖动排序，但不能改名/改链接/删除
 *   （改名需求请直接改本文件，重启/刷新后生效）。
 * 用户自定义站点不写进这里，而是经 websites Service 持久化到 Main Process 的
 *   userData/frequent-websites.json（见 src/services/websites.ts）。
 *
 * 字段约定：
 *   - id：稳定且唯一，作为排序与隐藏的键；改名/改链接时不要动 id，否则隐藏与排序会失效。
 *   - badge：徽标文字，最多 2 个字符（中文 1-2 字，英文 2 字母；支持小写）。
 *   - color：#rrggbb，取自 src/services/quickDirectories.ts 的 DIRECTORY_COLORS 色板
 *     （低饱和、克制），保证与常用目录 / P4 工作区的徽标视觉一致。
 */

export interface WebsitePreset {
  id: string
  /** 站点名称 */
  name: string
  /** 完整链接（含协议） */
  url: string
  /** 徽标文字，最多 2 个字符 */
  badge: string
  /** 标识色 #rrggbb */
  color: string
}

export const WEBSITE_PRESETS: readonly WebsitePreset[] = [
  {
    id: 'game-daily-report',
    name: '游戏日报',
    url: 'https://work-report.corp.kuaishou.com/#/report/new?type=1',
    badge: '日报',
    color: '#fa8c16', // 橙
  },
  {
    id: 'corp-docs',
    name: '云文档',
    url: 'https://docs.corp.kuaishou.com/home?mode=document',
    badge: '文档',
    color: '#1677ff', // 蓝
  },
  {
    id: 'gm-platform',
    name: 'GM平台',
    url: 'https://ksgame-gm-c7.corp.kuaishou.com/#/AreaClothing/RegionalNew',
    badge: 'GM',
    color: '#722ed1', // 紫
  },
  {
    id: 'private-server',
    name: '云私服平台',
    url: 'https://private-server.staging.kuaishou.com/C7/server/myServer',
    badge: '私服',
    color: '#13c2c2', // 青
  },
  {
    id: 'redmine',
    name: 'redmine',
    url: 'https://gamecloud-redmine.corp.kuaishou.com/1007/my/page',
    badge: 'RM',
    color: '#e2001a', // 红（Redmine 品牌红，见 components/ui/brandColors.ts REDMINE_RED）
  },
  {
    id: 'qa-tools',
    name: 'QA工具集合',
    url: 'https://c7-qatool.staging.kuaishou.com/my',
    badge: 'QA',
    color: '#52c41a', // 绿
  },
]
