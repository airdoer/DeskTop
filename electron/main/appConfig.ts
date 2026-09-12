import fs from 'node:fs/promises'
import path from 'node:path'

/*
 * appConfig — 本地自定义配置的清单与读写（纯模块，不依赖 electron，便于单测）.
 *
 * 「本地配置」= 落在 app.getPath('userData') 下的用户数据文件：常用目录 / 常用网站 /
 *   界面偏好 / P4 星标排序徽标。设置页要展示「配置存在哪、有哪些文件」并提供一键重置。
 *
 * 为什么单独建模块：扫描、展示、重置三处必须用同一份清单，否则新增落盘文件时会出现
 *   「列表看不到 / 重置漏删」这类静默不一致 —— 故清单只在这里声明一次。
 *
 * 不含 sso-session.json（见 electron/main/sso.ts）：它是登录会话而非用户偏好，
 *   重置配置不应该把用户踢出登录。
 */

export interface ConfigFileSpec {
  /** 落盘文件名（相对配置目录） */
  file: string
  /** 面向用户的说明：告诉用户这个文件里存的是什么 */
  label: string
}

/**
 * 单一数据源。新增落盘文件时只加一行，扫描 / 展示 / 重置自动跟随。
 * 与 ipc.ts 里各 *Path() 函数的文件名必须一致（那边负责实际读写）。
 */
export const CONFIG_FILES: readonly ConfigFileSpec[] = [
  { file: 'quick-directories.json', label: '常用目录' },
  { file: 'frequent-websites.json', label: '常用网站' },
  { file: 'ui-preferences.json', label: '界面偏好' },
  { file: 'p4-favorites.json', label: 'P4 星标工作区' },
  { file: 'p4-workspace-order.json', label: 'P4 工作区排序' },
  { file: 'p4-workspace-labels.json', label: 'P4 工作区徽标' },
]

export interface ConfigFileInfo extends ConfigFileSpec {
  exists: boolean
  /** 字节数；文件不存在时为 0 */
  size: number
}

export interface AppConfigInfo {
  /** 配置落盘目录（app.getPath('userData')） */
  directory: string
  files: ConfigFileInfo[]
  /** 已落盘的文件数，供 UI 判断「是否还有东西可重置」 */
  existing: number
}

export interface AppConfigResetResult {
  /** 实际删除的文件数（只统计原本存在的） */
  removed: number
  /** 删除后的最新状态，调用方一次往返即可刷新界面 */
  info: AppConfigInfo
}

/**
 * 扫描配置目录。
 *
 * 不存在的文件也会列出（exists:false）—— 用户需要看到「本来有哪些配置项」，
 * 只列已生成的文件会让重置后的面板变成一片空白，反而看不出重置了什么。
 */
export async function readAppConfigInfo(directory: string): Promise<AppConfigInfo> {
  // 目录可能尚未创建（全新安装，或刚被重置过），先补上：
  // 这样「打开配置目录」永远有目标可开，也避免 stat 逐个报 ENOENT。
  await fs.mkdir(directory, { recursive: true })

  const files = await Promise.all(
    CONFIG_FILES.map(async ({ file, label }): Promise<ConfigFileInfo> => {
      try {
        const stat = await fs.stat(path.join(directory, file))
        return { file, label, exists: stat.isFile(), size: stat.isFile() ? stat.size : 0 }
      } catch {
        return { file, label, exists: false, size: 0 }
      }
    }),
  )

  return { directory, files, existing: files.filter((f) => f.exists).length }
}

/**
 * 删除全部本地配置，恢复默认状态。
 *
 * 用「删文件」而不是「写入空对象」：各读取函数对缺失文件都回退到默认值，
 *   且 uiPreferences 的 undefined 语义正是「从未配置」——
 *   写入 {} 会让「从未配置」与「配置成空」混淆（主页布局会因此变成空布局而非默认布局）。
 *
 * 只删 CONFIG_FILES 里的文件：sso-session.json 等非配置数据不受影响。
 * 单个文件删不掉（被占用 / 权限）不中断其余文件，失败项在返回的 info 里仍是 exists:true，
 *   由 UI 如实展示，不谎报「已全部重置」。
 */
export async function resetAppConfig(directory: string): Promise<AppConfigResetResult> {
  const before = await readAppConfigInfo(directory)

  let removed = 0
  for (const entry of before.files) {
    if (!entry.exists) continue
    try {
      await fs.rm(path.join(directory, entry.file), { force: true })
      removed += 1
    } catch {
      /* 留给下面的重扫描如实反映 */
    }
  }

  return { removed, info: await readAppConfigInfo(directory) }
}
