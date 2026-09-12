import { useState } from 'react'
import { AppButton } from '@/components/ui/AppButton'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ExternalLinkIcon,
  P4VWindowIcon,
  RefreshIcon,
} from '@/components/ui/icons'
import { PERFORCE_BLUE } from '@/components/ui/brandColors'
import { toast } from '@/components/feedback/Toast'
import {
  openMergeResultInP4V,
  type PipelineStepId,
  type PipelineStepState,
  type PipelineStepStatus,
} from '@/services/p4Merge'
import type { P4VConnection } from '@/services/p4Workspaces'

/*
 * MergePipeline — 从左到右的 Merge 流程管线可视化.
 * 依据 docs/CROSS_BRANCH_MERGE_TOOL_SPEC.md §16（Merge 两阶段）+ §71（最终业务模型）：
 *   Preflight → Minimal Sync → Pending CL → P4 Integrate → P4 Resolve → Result
 *
 * 每步状态：idle / running / success / failed / skipped.
 *   - running 用旋转 Refresh 图标
 *   - success 用 Check 图标 + 绿色
 *   - failed 用 Close 图标 + 红色 + 可展开错误日志
 *   - skipped 用横线 + 灰色
 *   - idle 用数字编号 + 灰色
 *
 * Result 步骤成功后，右侧渲染 P4V 跳转快捷操作（spec §57/§58：辅助能力，非核心依赖）：
 *   - 打开源 Workspace
 *   - 打开目标 Workspace
 *   - 打开目标 Pending Changelist
 */

const STATUS_STYLES: Record<PipelineStepStatus, { dot: string; ring: string; text: string; label: string; bg: string }> = {
  idle: {
    dot: 'bg-foreground-secondary',
    ring: 'border-border',
    text: 'text-foreground-secondary',
    label: '待执行',
    bg: 'bg-surface-1',
  },
  running: {
    dot: 'bg-primary',
    ring: 'border-primary',
    text: 'text-primary',
    label: '执行中',
    bg: 'bg-surface-1',
  },
  success: {
    dot: 'bg-success',
    ring: 'border-success',
    text: 'text-success',
    label: '已完成',
    bg: 'bg-surface-1',
  },
  failed: {
    dot: 'bg-error',
    ring: 'border-error',
    text: 'text-error',
    label: '失败',
    bg: 'bg-surface-1',
  },
  skipped: {
    dot: 'bg-foreground-quaternary',
    ring: 'border-border',
    text: 'text-foreground-tertiary',
    label: '跳过',
    bg: 'bg-surface-2',
  },
}

function StepIcon({ status, index }: { status: PipelineStepStatus; index: number }) {
  if (status === 'running') {
    return <RefreshIcon size={13} className="animate-spin" />
  }
  if (status === 'success') {
    return <CheckIcon size={13} />
  }
  if (status === 'failed') {
    return <CloseIcon size={13} />
  }
  if (status === 'skipped') {
    return <span className="text-[12px] font-semibold leading-none">—</span>
  }
  return <span className="text-[12px] font-semibold leading-none">{index + 1}</span>
}

function formatDuration(startedAt?: number, endedAt?: number): string {
  if (!startedAt) return ''
  const end = endedAt ?? Date.now()
  const ms = Math.max(0, end - startedAt)
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface MergePipelineProps {
  steps: PipelineStepState[]
  /** Result 步骤成功后展示 P4V 跳转所需信息 */
  p4vActions?: {
    sourceClient: string
    targetClient: string
    targetChange?: number
    connection: P4VConnection
  }
  /** 是否正在执行（用于禁用 P4V 按钮避免执行中跳转） */
  running: boolean
}

export function MergePipeline({ steps, p4vActions, running }: MergePipelineProps) {
  const [expanded, setExpanded] = useState<Set<PipelineStepId>>(new Set())

  const toggleExpand = (id: PipelineStepId) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const resultStep = steps.find((s) => s.id === 'result')
  const showP4VActions =
    !!p4vActions && resultStep?.status === 'success'

  const openSource = async () => {
    if (!p4vActions) return
    const res = await openMergeResultInP4V({
      client: p4vActions.sourceClient,
      port: p4vActions.connection.port,
      user: p4vActions.connection.user,
      charset: p4vActions.connection.charset,
    })
    if (res.ok) toast.success(`已在 P4V 中打开源 Workspace`)
    else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
  }

  const openTarget = async () => {
    if (!p4vActions) return
    const res = await openMergeResultInP4V({
      client: p4vActions.targetClient,
      port: p4vActions.connection.port,
      user: p4vActions.connection.user,
      charset: p4vActions.connection.charset,
    })
    if (res.ok) toast.success(`已在 P4V 中打开目标 Workspace`)
    else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
  }

  const openPendingCL = async () => {
    if (!p4vActions || !p4vActions.targetChange) return
    const res = await openMergeResultInP4V({
      client: p4vActions.targetClient,
      port: p4vActions.connection.port,
      user: p4vActions.connection.user,
      charset: p4vActions.connection.charset,
      pendingChange: p4vActions.targetChange,
    })
    if (res.ok) toast.success(`已在 P4V 中打开 Pending CL #${p4vActions.targetChange}`)
    else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {steps.map((step, idx) => {
          const style = STATUS_STYLES[step.status]
          const isExpanded = expanded.has(step.id)
          const hasLogs = step.logs.length > 0 || !!step.error
          const lastLog = step.logs.length > 0 ? step.logs[step.logs.length - 1] : step.error ?? ''
          return (
            <div key={step.id} className="flex items-stretch gap-1 shrink-0">
              <div
                className={`flex flex-col w-36 rounded-md border ${style.ring} ${style.bg} overflow-hidden`}
              >
                <button
                  type="button"
                  onClick={() => hasLogs && toggleExpand(step.id)}
                  className={`flex items-center gap-1.5 px-2 h-14 text-left ${hasLogs ? 'cursor-pointer hover:bg-surface-hover' : 'cursor-default'} transition-colors`}
                  aria-expanded={hasLogs ? isExpanded : undefined}
                >
                  <span
                    className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-white ${style.dot}`}
                    aria-hidden
                  >
                    <StepIcon status={step.status} index={idx} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-foreground leading-4 truncate">
                      {step.label}
                    </div>
                    <div className={`text-[10px] leading-3 truncate ${style.text}`}>
                      {style.label}
                      {step.startedAt && (
                        <span className="text-foreground-quaternary ml-1" title="耗时">
                          {formatDuration(step.startedAt, step.endedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  {hasLogs && (
                    <span className="shrink-0 text-foreground-tertiary" aria-hidden>
                      {isExpanded ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
                    </span>
                  )}
                </button>
                {isExpanded && hasLogs && (
                  <div className="px-2 pb-2 pt-1 border-t border-border-subtle bg-surface-2 max-h-32 overflow-auto">
                    {step.error && (
                      <div className="text-[10px] text-error font-mono leading-4 mb-1">{step.error}</div>
                    )}
                    {step.logs.map((line, i) => (
                      <div key={i} className="text-[10px] text-foreground-secondary font-mono leading-4 whitespace-pre-wrap break-all">
                        {line}
                      </div>
                    ))}
                  </div>
                )}
                {!isExpanded && lastLog && (
                  <div className="px-2 pb-1.5 text-[10px] text-foreground-tertiary leading-3 truncate" title={lastLog}>
                    {lastLog}
                  </div>
                )}
              </div>
              {idx < steps.length - 1 && (
                <div className="flex items-center text-foreground-quaternary shrink-0" aria-hidden>
                  <ChevronRightIcon size={12} />
                </div>
              )}
            </div>
          )
        })}

        {/* Result 成功后：P4V 跳转快捷操作区（spec §57/§58） */}
        {showP4VActions && (
          <>
            <div className="flex items-center text-foreground-quaternary shrink-0" aria-hidden>
              <ChevronRightIcon size={12} />
            </div>
            <div className="flex flex-col justify-center gap-1.5 shrink-0 rounded-md border border-primary/40 bg-primary-bg px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary leading-4">
                <P4VWindowIcon size={14} style={{ color: PERFORCE_BLUE }} />
                P4V 跳转
              </div>
              <div className="flex items-center gap-1">
                <AppButton size="sm" variant="default" onClick={openSource} disabled={running}>
                  <ExternalLinkIcon size={12} />
                  源 WS
                </AppButton>
                <AppButton size="sm" variant="default" onClick={openTarget} disabled={running}>
                  <ExternalLinkIcon size={12} />
                  目标 WS
                </AppButton>
                <AppButton
                  size="sm"
                  variant="primary"
                  onClick={openPendingCL}
                  disabled={running || !p4vActions.targetChange}
                  title={p4vActions.targetChange ? `打开 Pending CL #${p4vActions.targetChange}` : '未创建 Pending CL'}
                >
                  <ExternalLinkIcon size={12} />
                  Pending CL
                </AppButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
