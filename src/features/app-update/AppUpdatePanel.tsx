import { useCallback, useEffect, useState } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { NavIcon } from '@/shell/NavIcon'
import {
  cancelAppUpdateDownload,
  checkAppUpdate,
  getAppInfo,
  onUpdateAvailability,
  onUpdateDownloaded,
  onUpdateError,
  onUpdateProgress,
  quitAndInstallAppUpdate,
  startAppUpdateDownload,
} from '@/services/appUpdate'

/*
 * AppUpdatePanel — 设置页「软件更新」面板.
 *
 * 数据流见 services/appUpdate.ts：检查结果与下载进度都靠主进程事件回来，
 *   故事件订阅只做一次（deps 为空），其余全部走 setState。
 *
 * 只在打包态放开更新入口：开发态没有 resources/app-update.yml，
 *   electron-updater 必然报错，直接标注「开发模式不可用」比暴露英文报错清楚。
 */

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/**
 * 检查超时保护。主进程只在 update-available / update-not-available 时发事件，
 * 部分错误路径（如 DNS 解析失败走 error 事件而非 reject）不会回来，
 * 没有这层保护 UI 会永久停在「正在检查…」。
 */
const CHECK_TIMEOUT_MS = 30000

function describeStatus(
  status: UpdateStatus,
  newVersion: string | undefined,
  percent: number,
  errorMessage: string | undefined,
): string {
  switch (status) {
    case 'idle':
      return '尚未检查'
    case 'checking':
      return '正在检查…'
    case 'up-to-date':
      return '已是最新版本'
    case 'available':
      return newVersion ? `发现新版本 v${newVersion}` : '发现新版本'
    case 'downloading':
      return `正在下载 ${percent}%`
    case 'downloaded':
      return '下载完成，重启后生效'
    case 'error':
      return errorMessage ?? '更新失败'
    default:
      return '尚未检查'
  }
}

function describeStatusClass(status: UpdateStatus): string {
  if (status === 'error') return 'text-error'
  if (status === 'up-to-date') return 'text-success'
  if (status === 'available' || status === 'downloaded') return 'text-primary'
  return 'text-foreground'
}

export function AppUpdatePanel() {
  const [version, setVersion] = useState('')
  const [packaged, setPackaged] = useState(false)
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [newVersion, setNewVersion] = useState<string>()
  const [percent, setPercent] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string>()

  useEffect(() => {
    void getAppInfo().then((info) => {
      setVersion(info.version)
      setPackaged(info.packaged)
    })
  }, [])

  useEffect(() => {
    const offAvailability = onUpdateAvailability((payload) => {
      if (payload.version) setVersion(payload.version)
      setErrorMessage(undefined)
      if (payload.update) {
        setNewVersion(payload.newVersion)
        setStatus('available')
      } else {
        setNewVersion(undefined)
        setStatus('up-to-date')
      }
    })
    const offProgress = onUpdateProgress((info) => {
      setPercent(Math.round(info.percent ?? 0))
      setStatus('downloading')
    })
    const offDownloaded = onUpdateDownloaded(() => {
      setPercent(100)
      setStatus('downloaded')
    })
    const offError = onUpdateError((message) => {
      setErrorMessage(message)
      setStatus('error')
    })
    return () => {
      offAvailability()
      offProgress()
      offDownloaded()
      offError()
    }
  }, [])

  useEffect(() => {
    if (status !== 'checking') return
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === 'checking' ? 'error' : current))
      setErrorMessage((current) => current ?? '检查超时，请确认能访问更新服务器')
    }, CHECK_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  const handleCheck = useCallback(async () => {
    setErrorMessage(undefined)
    setStatus('checking')
    const outcome = await checkAppUpdate()
    if (!outcome.ok) {
      setErrorMessage(outcome.message)
      setStatus('error')
    }
  }, [])

  const handleDownload = useCallback(async () => {
    setPercent(0)
    setStatus('downloading')
    await startAppUpdateDownload()
  }, [])

  const handleCancel = useCallback(async () => {
    await cancelAppUpdateDownload()
    setPercent(0)
    setStatus('available')
  }, [])

  const handleInstall = useCallback(() => {
    void quitAndInstallAppUpdate()
  }, [])

  const busy = status === 'downloading' || status === 'downloaded'

  return (
    <Panel
      title="软件更新"
      icon={<NavIcon id="settings" />}
      help="从内网更新服务器检测新版本。下载完成后点「重启并安装」生效，用户配置与本地数据不会丢失。"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-8">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-foreground-tertiary leading-4">当前版本</span>
            <span className="text-[13px] text-foreground font-mono leading-5">{version || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs text-foreground-tertiary leading-4">状态</span>
            <span className={`text-[13px] leading-5 ${describeStatusClass(status)}`}>
              {describeStatus(status, newVersion, percent, errorMessage)}
            </span>
          </div>
        </div>

        {(status === 'downloading' || status === 'downloaded') && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs text-foreground-secondary tabular-nums">
              {percent}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <AppButton
            size="sm"
            onClick={handleCheck}
            loading={status === 'checking'}
            disabled={busy || !packaged}
          >
            检查更新
          </AppButton>
          {status === 'available' && (
            <AppButton size="sm" variant="primary" onClick={handleDownload}>
              下载更新
            </AppButton>
          )}
          {status === 'downloading' && (
            <AppButton size="sm" onClick={handleCancel}>
              取消下载
            </AppButton>
          )}
          {status === 'downloaded' && (
            <AppButton size="sm" variant="primary" onClick={handleInstall}>
              重启并安装
            </AppButton>
          )}
        </div>

        {!packaged && (
          <p className="text-xs text-foreground-tertiary leading-4">
            当前为开发模式，更新功能仅在安装版中可用。
          </p>
        )}
      </div>
    </Panel>
  )
}
