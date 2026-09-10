import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { CheckIcon, CloseIcon, CopyIcon, MonitorSolidIcon, RefreshIcon } from '@/components/ui/icons'
import { WINDOWS_BLUE } from '@/components/ui/brandColors'
import { toast } from '@/components/feedback/Toast'
import {
  getEncodingStatus,
  getSystemInfo,
  runEncodingRepair,
  type EncodingStatus,
  type SystemInfo,
} from '@/services/systemInfo'
import { usePanelCollapsed } from '@/hooks/usePanelCollapsed'
import { PANEL_COLLAPSED_KEYS } from '@/services/uiPreferences'

/*
 * SystemInfoPanel — Business Feature：展示本机主机名、IPv4 与系统编码状态。
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26，数据通过 systemInfo Service（IPC）获取。
 * §11.1 复制成功用 Toast 反馈；§20 加载用局部 loading 而非全屏 spinner。
 *
 * 编码一行的判定口径见 src/services/systemInfo.ts：
 *   系统 ACP = 65001 且 P4CHARSET = utf8 → 编码正确，否则编码异常并给出修复入口。
 */

export function SystemInfoPanel() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [encoding, setEncoding] = useState<EncodingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [repairing, setRepairing] = useState(false)
  const [repairError, setRepairError] = useState<string>()
  const { collapsed, toggle } = usePanelCollapsed(PANEL_COLLAPSED_KEYS.systemInfo)

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setError(undefined)
    setRepairError(undefined)
    try {
      // 编码检测要读注册表 + 执行 p4 set，与主机信息并行取，失败不牵连主信息
      const [system, encodingStatus] = await Promise.all([
        getSystemInfo(forceRefresh),
        getEncodingStatus().catch(() => null),
      ])
      setInfo(system)
      setEncoding(encodingStatus)
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

  /*
   * 执行编码修复脚本：主进程会定位 //C7/Development/Mainline 工作区并以管理员权限运行
   * Design/设置编码格式（需要以管理员运行）.bat。这里只负责发起与反馈，
   * 提权由系统 UAC 接管，脚本执行结果不在应用内回传。
   */
  const repair = useCallback(async () => {
    setRepairing(true)
    setRepairError(undefined)
    try {
      const result = await runEncodingRepair()
      if (!result.ok) {
        setRepairError(result.error ?? '启动失败')
        return
      }
      toast.success('修复脚本已启动，请在 UAC 提示中允许，执行后重启系统')
    } catch (e) {
      setRepairError(e instanceof Error ? e.message : String(e))
    } finally {
      setRepairing(false)
    }
  }, [])

  // 主 IPv4（默认路由所在网卡）之外仍然有效的地址
  const others = info ? info.ipv4List.filter((ip) => ip !== info.ipv4) : []

  return (
    <Panel
      title="系统信息"
      icon={<MonitorSolidIcon size={14} style={{ color: WINDOWS_BLUE }} />}
      help="当前主机网络标识与系统编码"
      collapsible
      collapsed={collapsed}
      onToggleCollapsed={toggle}
      actions={
        <AppButton
          variant="ghost"
          size="sm"
          onClick={() => void load(true)}
          loading={loading}
          aria-label="刷新"
        >
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
        // 列表按表格处理：主行左右出血到 Panel 边缘并加斑马纹，附加 IP 行作为从属信息不加底色
        <div className="flex flex-col">
          <InfoRow
            index={0}
            label="主机名"
            value={info.hostname}
            onCopy={() => copy(info.hostname, '主机名')}
          />
          <InfoRow
            index={1}
            label="IPv4"
            value={info.ipv4}
            onCopy={() => copy(info.ipv4, 'IPv4')}
            extra={
              info.ipv4List.length > 1 ? (
                <span className="text-xs text-foreground-tertiary">共 {info.ipv4List.length} 个</span>
              ) : null
            }
          />
          {others.length > 0 && (
            <div className="mt-1 pl-[92px] flex flex-col gap-0.5">
              {others.map((ip) => (
                <InfoRow key={ip} index={0} label="" value={ip} onCopy={() => copy(ip, 'IPv4')} compact />
              ))}
            </div>
          )}
          {encoding && (
            <>
              <InfoRow
                index={2}
                label="当前编码"
                value={`ACP ${encoding.acp ?? '未设置'} · P4CHARSET ${encoding.p4Charset ?? '未设置'}`}
                extra={<EncodingBadge ok={encoding.ok} />}
              />
              {!encoding.ok && (
                // 修复引导：说明脚本做了什么 + 一个入口按钮，避免用户自己去翻工作区
                <div className="mt-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-2 flex flex-col gap-2">
                  <p className="text-xs leading-5 text-foreground-secondary">
                    {describeEncodingIssues(encoding)}
                    请执行 Mainline 工作区（//C7/Development/Mainline）中的「设置编码格式（需要以管理员运行）.bat」：
                    脚本会设置 P4CHARSET=utf8 并把系统代码页改为 65001，完成后需重启系统生效。
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <AppButton size="sm" loading={repairing} onClick={() => void repair()}>
                      执行修复脚本
                    </AppButton>
                    {repairError && <span className="text-xs text-error">{repairError}</span>}
                  </div>
                </div>
              )}
              {encoding.note && (
                <p className="mt-1 text-[11px] leading-4 text-foreground-tertiary">{encoding.note}</p>
              )}
            </>
          )}
        </div>
      ) : null}
    </Panel>
  )
}

/** 状态标签：正确用 success、异常用 error，与 Toast 语义色一致 */
function EncodingBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
        ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
      }`}
    >
      {ok ? <CheckIcon size={11} /> : <CloseIcon size={11} />}
      {ok ? '编码正确' : '编码异常'}
    </span>
  )
}

/** 把不达标的项列出来，替换笼统的「编码异常」，便于用户判断要改哪一边 */
function describeEncodingIssues(encoding: EncodingStatus): string {
  const issues: string[] = []
  if (!encoding.acpOk) issues.push(`系统代码页为 ${encoding.acp ?? '未设置'}（应为 65001）`)
  if (encoding.charsetOk === false) {
    issues.push(`P4CHARSET 为 ${encoding.p4Charset ?? '未设置'}（应为 utf8）`)
  }
  if (issues.length === 0) return '编码未达到 UTF-8 要求。'
  return `${issues.join('、')}；`
}

function InfoRow({
  index,
  label,
  value,
  onCopy,
  extra,
  compact = false,
}: {
  /** 主行序号，用于斑马纹（从属行 compact 不参与） */
  index: number
  label: string
  value: string
  /** 省略时右侧不渲染复制按钮（编码行没有复制价值） */
  onCopy?: () => void
  extra?: ReactNode
  compact?: boolean
}) {
  const striped = !compact && index % 2 === 1
  return (
    <div
      className={`grid items-center gap-2 ${
        compact
          ? 'grid-cols-[1fr_auto] h-7'
          : 'grid-cols-[80px_1fr_auto] h-8 -mx-3 px-3'
      } ${striped ? 'bg-surface-2' : ''}`}
    >
      {label && <dt className="text-xs text-foreground-tertiary truncate">{label}</dt>}
      <dd className="min-w-0 text-[13px] text-foreground truncate font-mono">{value || '—'}</dd>
      <div className="flex items-center gap-1.5">
        {extra}
        {onCopy && (
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
        )}
      </div>
    </div>
  )
}
