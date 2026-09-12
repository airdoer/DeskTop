import { useCallback, useEffect, useState } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { RefreshIcon } from '@/components/ui/icons'
import { toast } from '@/components/feedback/Toast'
import { NavIcon } from '@/shell/NavIcon'
import {
  getAppConfigInfo,
  resetAppConfig,
  type AppConfigInfo,
  type ConfigFileInfo,
} from '@/services/appConfig'
import { openPath } from '@/services/paths'

/*
 * AppConfigPanel — 设置页「本地配置」面板：配置落盘目录 + 一键重置.
 *
 * 两件事：①告诉用户常用目录 / 常用网站等自定义配置存在哪个目录（可直接打开查看或备份）；
 *   ②提供一键重置，把全部本地自定义配置恢复默认。
 *
 * 「打开目录」复用 path:open（services/paths.ts），不新增业务命名通道。
 *
 * 重置后 reload 整个渲染层，而不是只刷新本面板：
 *   配置的消费方分散在各处（Sidebar 的折叠态、各面板的视图模式与筛选、主页布局），
 *   它们都只在挂载时读一次磁盘。逐个通知需要给每个消费方加订阅，漏掉一个就会出现
 *   「重置了但某处还是旧值」的静默不一致；reload 一次把这件事变成结构性正确。
 *   SsoSession 不在重置范围内，reload 后仍保持登录。
 */

/** 重置后先让用户看清提示再刷新，避免 toast 一闪而过 */
const RELOAD_DELAY_MS = 700

/** 配置都是 JSON，小文件显示字节数即可 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function ConfigFileRow({ entry, striped }: { entry: ConfigFileInfo; striped: boolean }) {
  return (
    <div className={`flex items-center gap-2 h-10 px-2.5 ${striped ? 'bg-surface-2' : 'bg-surface-1'}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground truncate leading-5">{entry.label}</div>
        <div className="text-xs text-foreground-tertiary truncate leading-4 font-mono">
          {entry.file}
        </div>
      </div>
      {/* 「未创建」用 tertiary 而不是 quaternary：它是有效状态信息，
          0.25 alpha 的对比度不足以承载文字（quaternary 只用于装饰/禁用） */}
      <span
        className={`shrink-0 text-xs leading-4 tabular-nums ${
          entry.exists ? 'text-foreground-secondary' : 'text-foreground-tertiary'
        }`}
      >
        {entry.exists ? formatSize(entry.size) : '未创建'}
      </span>
    </div>
  )
}

export function AppConfigPanel() {
  const [info, setInfo] = useState<AppConfigInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setInfo(await getAppConfigInfo())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleOpenDirectory = useCallback(async () => {
    if (!info?.directory) return
    const result = await openPath(info.directory)
    if (!result.ok) {
      toast.error(`打开配置目录失败：${result.error ?? '未知错误'}`)
    }
  }, [info?.directory])

  const handleReset = useCallback(async () => {
    setResetting(true)
    const result = await resetAppConfig()
    setResetting(false)
    if (!result) {
      toast.error('重置失败，请检查配置目录是否可写')
      return
    }
    setConfirming(false)
    setInfo(result.info)
    toast.success(`已重置 ${result.removed} 项本地配置，正在重新加载…`)
    window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
  }, [])

  const directory = info?.directory ?? ''
  const files = info?.files ?? []
  const existing = info?.existing ?? 0

  return (
    <Panel
      title="本地配置"
      icon={<NavIcon id="settings" />}
      help="常用目录、常用网站、界面偏好、P4 星标等自定义配置都存在本机这个目录里，应用升级或重装不会清空。重置会删除这些文件并恢复默认，登录状态不受影响。"
      actions={
        <AppButton
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          loading={loading}
          aria-label="刷新"
        >
          <RefreshIcon size={14} />
          刷新
        </AppButton>
      }
    >
      <div className="flex flex-col gap-3">
        {/* 落盘目录 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-foreground-tertiary leading-4">配置目录</span>
          <div className="flex items-center gap-2 min-w-0">
            <code
              className="min-w-0 flex-1 font-mono text-[12px] text-foreground-secondary bg-surface-2 border border-border-subtle rounded px-1 py-0.5 truncate"
              title={directory}
            >
              {directory || '—'}
            </code>
            <AppButton size="sm" onClick={() => void handleOpenDirectory()} disabled={!directory}>
              打开目录
            </AppButton>
          </div>
        </div>

        {/* 文件清单：不存在的也列出，用户才能看清「一共有哪些配置项」 */}
        <div className="flex flex-col rounded-md border border-border-subtle overflow-hidden">
          {files.length === 0 ? (
            <div className="h-10 px-2.5 flex items-center text-xs text-foreground-tertiary">
              {loading ? '读取中…' : '未读取到配置项'}
            </div>
          ) : (
            files.map((entry, index) => (
              <ConfigFileRow key={entry.file} entry={entry} striped={index % 2 === 1} />
            ))
          )}
        </div>

        {/* 重置：不可逆操作，先确认再执行（§11.3 危险操作需明确确认 + 文案明确） */}
        {confirming ? (
          <div className="rounded-md border border-error/40 bg-error/5 px-3 py-2.5 flex flex-col gap-2">
            <div className="text-[12.5px] font-semibold text-error leading-5">
              重置全部本地配置？
            </div>
            <div className="text-[12px] text-foreground-secondary leading-5">
              将删除上方列出的 {existing} 项已保存配置并恢复默认值，
              <span className="text-foreground font-medium">该操作无法撤销</span>。
              常用目录、常用网站、P4 星标与排序、界面偏好（含侧边栏与主页布局）都会清空，
              登录状态不受影响。
            </div>
            <div className="flex items-center gap-2">
              <AppButton
                size="md"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={resetting}
              >
                取消
              </AppButton>
              <AppButton
                size="md"
                variant="danger"
                onClick={() => void handleReset()}
                loading={resetting}
              >
                重置全部配置
              </AppButton>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <AppButton
              size="sm"
              variant="danger"
              onClick={() => setConfirming(true)}
              disabled={existing === 0}
            >
              一键重置
            </AppButton>
            <span className="text-xs text-foreground-tertiary leading-4">
              {existing === 0 ? '当前没有已保存的自定义配置' : '清空全部自定义配置并恢复默认'}
            </span>
          </div>
        )}
      </div>
    </Panel>
  )
}
