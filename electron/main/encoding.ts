/*
 * 系统编码（UTF-8）检测与修复脚本定位：纯逻辑部分（不含 Electron / IO）。
 * 独立成文件以便单元测试（见 test/encoding.test.ts）：
 *   electron/main/ipc.ts 依赖 electron 模块，无法在 vitest 的 node 环境里直接 import。
 *
 * 判定依据来自 Design/设置编码格式（需要以管理员运行）.bat 实际做的两件事：
 *   1. `p4 set P4CHARSET=utf8`
 *      → 写入 P4 客户端环境变量（Windows 上落在注册表 / P4CONFIG），只影响 p4 / p4v 与服务器的转码。
 *   2. 注册表 HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage 下
 *      ACP / OEMCP / MACCP = 65001
 *      → 系统 ANSI / OEM / Mac 代码页改为 UTF-8（即「Beta: 使用 Unicode UTF-8 提供全球语言支持」），
 *        需管理员权限且必须重启后才对非 Unicode 程序生效。
 * 因此「编码正确」= 系统 ACP 为 65001 且 P4CHARSET 为 utf8。
 */

import path from 'node:path'
import type { P4ClientRecord } from './p4'

/** 系统代码页注册表键（脚本用 reg add 修改的三个值都在这里） */
export const CODE_PAGE_REG_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage'

/** UTF-8 的代码页编号；脚本把 ACP / OEMCP / MACCP 全部写成 65001 */
export const EXPECTED_CODE_PAGE = '65001'

/** 脚本写入的 P4CHARSET 取值 */
export const EXPECTED_P4_CHARSET = 'utf8'

/** 修复脚本所在工作区的 stream：Mainline */
export const MAINLINE_STREAM = '//C7/Development/Mainline'

/** 修复脚本相对工作区根目录的路径 */
export const FIX_SCRIPT_RELATIVE_PATH = 'Design/设置编码格式（需要以管理员运行）.bat'

/** 注册表 reg query 读到的代码页值；缺省表示该值不存在（Windows 未显式设置，走内建默认） */
export interface CodePageValues {
  acp?: string
  oemcp?: string
  maccp?: string
}

/**
 * 编码检测结果。
 * 该接口在 src/services/systemInfo.ts 有一份同构副本（主进程与渲染进程不能互相 import），
 * 修改字段时必须同步另一侧。
 */
export interface EncodingStatus {
  /** 综合结论：系统代码页为 UTF-8，且 P4CHARSET 校验通过或未执行校验 */
  ok: boolean
  /** 系统 ANSI 代码页（ACP）是否为 65001 */
  acpOk: boolean
  /** P4CHARSET 是否为 utf8；未执行校验时为 undefined，不参与结论 */
  charsetOk?: boolean
  acp?: string
  oemcp?: string
  maccp?: string
  /** 归一化后的 P4CHARSET；未设置时为 undefined */
  p4Charset?: string
  /** 补充诊断信息（如 p4 不可用、非 Windows 平台） */
  note?: string
}

/**
 * 修复脚本执行结果。
 * 同样在 src/services/systemInfo.ts 有一份同构副本，改字段需同步。
 */
export interface EncodingRepairResult {
  ok: boolean
  error?: string
  /** 命中的 Mainline 工作区根目录 */
  root?: string
  /** 实际执行的 bat 绝对路径（失败时也可能返回，便于用户手动定位） */
  scriptPath?: string
}

/**
 * 解析 `reg query "HKLM\...\CodePage"` 输出。
 * 形如：
 *   HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Nls\CodePage
 *       ACP    REG_SZ    65001
 * 非数据行（键路径、空行、错误提示）直接跳过；读取失败时返回空对象。
 */
export function parseRegQueryOutput(output: string): CodePageValues {
  const values: CodePageValues = {}
  for (const raw of output.split(/\r?\n/)) {
    const matched = /^\s*(\S+)\s+REG_\w+\s*(.*)$/.exec(raw)
    if (!matched) continue
    const key = matched[1].toLowerCase()
    const value = (matched[2] ?? '').trim()
    if (!value) continue
    if (key === 'acp') values.acp = value
    else if (key === 'oemcp') values.oemcp = value
    else if (key === 'maccp') values.maccp = value
  }
  return values
}

/** 代码页是否为 UTF-8（65001）；空值一律视为未设置 → false */
export function isUtf8CodePage(value?: string): boolean {
  return (value ?? '').trim() === EXPECTED_CODE_PAGE
}

/**
 * 归一化 P4CHARSET。
 * p4 未设置该变量时 `p4 set` 不会输出该键，或输出 "unset" / "not set" 之类的占位文本，
 * 统一折算为 undefined，避免把占位字符串当成实际取值展示。
 */
export function normalizeP4Charset(value?: string): string | undefined {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return undefined
  if (/^(unset|not set|none|n\/a)$/i.test(trimmed)) return undefined
  return trimmed
}

/** P4CHARSET 是否为 UTF-8。脚本写入的是 utf8，utf-8 视为等价写法 */
export function isUtf8Charset(value?: string): boolean {
  return /^utf-?8$/i.test((value ?? '').trim())
}

/**
 * 综合判定编码状态。
 * @param codePages 注册表读到的代码页
 * @param p4        P4CHARSET 校验情况：checked=false 表示未执行校验（p4 不可用或查询失败），
 *                  此时 charsetOk 为 undefined，结论只取决于系统代码页。
 */
export function evaluateEncoding(
  codePages: CodePageValues,
  p4: { checked: boolean; charset?: string } = { checked: false },
): EncodingStatus {
  const acpOk = isUtf8CodePage(codePages.acp)
  const charset = normalizeP4Charset(p4.charset)
  const charsetOk = p4.checked ? isUtf8Charset(charset) : undefined

  const status: EncodingStatus = {
    ok: acpOk && charsetOk !== false,
    acpOk,
    charsetOk,
    acp: codePages.acp,
    oemcp: codePages.oemcp,
    maccp: codePages.maccp,
    p4Charset: charset,
  }
  if (!p4.checked) status.note = '未校验 P4CHARSET：p4 不可用或查询失败'
  return status
}

/**
 * 从 p4 clients 记录中定位 Mainline 工作区。
 * 先按 stream 全等（忽略大小写）匹配；无命中时退化为「以 /Development/Mainline 结尾」，
 * 兼容 stream 名带尾斜杠或大小写差异的情况。
 */
export function findMainlineWorkspace(records: P4ClientRecord[]): P4ClientRecord | null {
  const normalize = (value?: string) => (value ?? '').trim().replace(/\/+$/, '').toLowerCase()
  const target = normalize(MAINLINE_STREAM)
  const exact = records.find((r) => r.client && r.root && normalize(r.stream) === target)
  if (exact) return exact
  return (
    records.find((r) => {
      const stream = normalize(r.stream)
      return Boolean(r.client && r.root && stream.endsWith('/development/mainline'))
    }) ?? null
  )
}

/** 拼接修复脚本在工作区内的绝对路径 */
export function fixScriptPath(root: string): string {
  return path.join(root, ...FIX_SCRIPT_RELATIVE_PATH.split('/'))
}
