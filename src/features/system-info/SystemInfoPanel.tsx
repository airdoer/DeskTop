import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { CopyIcon, RefreshIcon } from '@/components/ui/icons'
import { toast } from '@/components/feedback/Toast'
import { getSystemInfo, type SystemInfo } from '@/services/systemInfo'

/*
 * SystemInfoPanel — Business Feature：展示本机主机名与 IPv4.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26，数据通过 systemInfo Service（IPC）获取。
 * §11.1 复制成功用 Toast 反馈；§20 加载用局部 loading 而非全屏 spinner。
 */

export function SystemInfoPanel() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setInfo(await getSystemInfo())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copy = useCallback(async (text: string, label: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label}已复制`)
    } catch {
      toast.error('复制失败')
    }
  }, [])

  return (
    <Panel
      title="系统信息"
      description="当前主机网络标识"
      actions={
        <AppButton variant="ghost" size="sm" onClick={load} loading={loading} aria-label="刷新">
          <RefreshIcon size={14} />
          刷新
        </AppButton>
      }
    >
      {loading && !info ? (
        <div className="text-xs text-foreground-tertiary py-2">加载中…</div>
      ) : error ? (
        <div className="text-xs text-error py-2">{error}</div>
      ) : info ? (
        <div className="flex flex-col">
          <InfoRow label="主机名" value={info.hostname} onCopy={() => copy(info.hostname, '主机名')} />
          <InfoRow
            label="IPv4"
            value={info.ipv4}
            onCopy={() => copy(info.ipv4, 'IPv4')}
            extra={
              info.ipv4List.length > 1 ? (
                <span className="text-xs text-foreground-tertiary">共 {info.ipv4List.length} 个</span>
              ) : null
            }
          />
          {info.ipv4List.length > 1 && (
            <div className="mt-1 pl-[92px] flex flex-col gap-0.5">
              {info.ipv4List.slice(1).map((ip) => (
                <InfoRow key={ip} label="" value={ip} onCopy={() => copy(ip, 'IPv4')} compact />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Panel>
  )
}

function InfoRow({
  label,
  value,
  onCopy,
  extra,
  compact = false,
}: {
  label: string
  value: string
  onCopy: () => void
  extra?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={`grid items-center gap-2 ${compact ? 'grid-cols-[1fr_auto] h-7' : 'grid-cols-[80px_1fr_auto] h-8'}`}
    >
      {label && <dt className="text-xs text-foreground-tertiary truncate">{label}</dt>}
      <dd className="min-w-0 text-[13px] text-foreground truncate font-mono">{value || '—'}</dd>
      <div className="flex items-center gap-1.5">
        {extra}
        <AppButton
          variant="ghost"
          size="sm"
          onClick={onCopy}
          aria-label="复制"
          title="复制"
          className="!px-1"
        >
          <CopyIcon size={13} />
        </AppButton>
      </div>
    </div>
  )
}
