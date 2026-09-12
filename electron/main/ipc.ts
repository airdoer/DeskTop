import { app, ipcMain, shell, BrowserWindow } from 'electron'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { execFile, spawn, spawnSync } from 'node:child_process'
import {
  buildP4VArgs,
  buildWindowsBatchCommand,
  normalizeFavoriteNames,
  parseP4Set,
  parseTaggedClients,
  selectLocalWorkspaces,
  type P4Workspace,
} from './p4'
import {
  buildIntegrateArgs,
  buildPendingChangeDescription,
  buildResolveArgs,
  buildResolveOverrideArgs,
  buildRevertArgs,
  buildOpenedArgs,
  buildSyncArgs,
  computeMergePreview,
  createInitialPipeline,
  generateTransactionId,
  BINARY_EXTENSIONS,
  getExtension,
  MergeToolRegistry,
  parseDescribeOutput,
  parseOpenedOutput,
  parseTaggedChanges,
  replaceChangeFormDescription,
  summarizeP4Error,
  type BranchMapping,
  type MergePreview,
  type MergeTool,
  type P4Changelist,
  type P4ChangeFile,
  type P4OpenedFile,
  type PipelineStepId,
  type PipelineStepState,
} from './p4Merge'
import { sanitizeLabelsMap, type WorkspaceLabels } from './p4Labels'
import {
  CODE_PAGE_REG_KEY,
  MAINLINE_STREAM,
  evaluateEncoding,
  findMainlineWorkspace,
  fixScriptPath,
  parseRegQueryOutput,
  type CodePageValues,
  type EncodingRepairResult,
  type EncodingStatus,
} from './encoding'
import { fetchRedmineIssues } from './redmine'
import { normalizeWebsiteUrl, sanitizeWebsiteConfig, type WebsiteConfig } from './websites'
import { startSsoLogin, readSsoSession, clearSsoSession, type SsoSession, type SsoResult } from './sso'

/*
 * IPC handlers for Desktop native capabilities.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：Renderer 禁止直接调用 Electron/Node API，
 * 必须通过 IPC Service 访问。本模块是这些 Desktop Service 在 Main 侧的实现。
 */

export interface SystemInfo {
  hostname: string
  ipv4: string
  ipv4List: string[]
  platform: NodeJS.Platform
}

export interface QuickDirectory {
  id: string
  name: string
  path: string
  /** 标识色 #rrggbb，可选；缺省时由 Renderer 稳定派生 */
  color?: string
  /** 图标字母标识，最多 2 个字符，可选 */
  badge?: string
}

export interface PathStat {
  path: string
  name: string
  exists: boolean
  isDirectory: boolean
}

/** Re-export 让 ipc.ts 的 handler 签名与 redmine.ts 的类型保持一致，避免循环依赖 */
export type RedmineIssuesSnapshot = import('./redmine').RedmineIssuesSnapshot

interface QuickDirsStore {
  directories: QuickDirectory[]
}

/** 常用目录上限，与 src/services/quickDirectories.ts 的 MAX_QUICK_DIRECTORIES 必须保持一致 */
const MAX_DIRECTORIES = 10
const STORE_FILE = 'quick-directories.json'
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const MAX_BADGE_LENGTH = 2

/** UI 偏好（视图模式等）：与业务数据分开存放，见 UI_PREFS_FILE */
const UI_PREFS_FILE = 'ui-preferences.json'
const UI_PREF_MAX_KEYS = 50
const UI_PREF_MAX_KEY_LENGTH = 64
const UI_PREF_MAX_VALUE_LENGTH = 200

/** P4 星标（收藏的 client 名列表） */
const P4_FAVORITES_FILE = 'p4-favorites.json'

/** P4 工作区自定义排序（client 名列表，与 favorites 同样净化） */
const P4_WORKSPACE_ORDER_FILE = 'p4-workspace-order.json'

/** P4 工作区徽标自定义（client 名 → {badge?, color?}，只读快照下的用户标注） */
const P4_WORKSPACE_LABELS_FILE = 'p4-workspace-labels.json'

/** 常用网站的用户配置（显示顺序 / 隐藏的内置站点 / 自定义站点） */
const WEBSITES_FILE = 'frequent-websites.json'

function storePath(): string {
  return path.join(app.getPath('userData'), STORE_FILE)
}

function uiPrefsPath(): string {
  return path.join(app.getPath('userData'), UI_PREFS_FILE)
}

function p4FavoritesPath(): string {
  return path.join(app.getPath('userData'), P4_FAVORITES_FILE)
}

function p4WorkspaceOrderPath(): string {
  return path.join(app.getPath('userData'), P4_WORKSPACE_ORDER_FILE)
}

function p4WorkspaceLabelsPath(): string {
  return path.join(app.getPath('userData'), P4_WORKSPACE_LABELS_FILE)
}

function websitesPath(): string {
  return path.join(app.getPath('userData'), WEBSITES_FILE)
}

async function readWebsitesConfig(): Promise<WebsiteConfig> {
  try {
    const raw = await fs.readFile(websitesPath(), 'utf-8')
    return sanitizeWebsiteConfig(JSON.parse(raw))
  } catch {
    return { order: [], hidden: [], custom: [] }
  }
}

async function writeWebsitesConfig(config: WebsiteConfig): Promise<void> {
  await fs.mkdir(path.dirname(websitesPath()), { recursive: true })
  await fs.writeFile(websitesPath(), JSON.stringify(config, null, 2), 'utf-8')
}

async function readP4Favorites(): Promise<string[]> {
  try {
    const raw = await fs.readFile(p4FavoritesPath(), 'utf-8')
    return normalizeFavoriteNames((JSON.parse(raw) as { names?: unknown })?.names)
  } catch {
    return []
  }
}

async function writeP4Favorites(names: string[]): Promise<void> {
  await fs.mkdir(path.dirname(p4FavoritesPath()), { recursive: true })
  await fs.writeFile(p4FavoritesPath(), JSON.stringify({ names }, null, 2), 'utf-8')
}

async function readP4WorkspaceOrder(): Promise<string[]> {
  try {
    const raw = await fs.readFile(p4WorkspaceOrderPath(), 'utf-8')
    return normalizeFavoriteNames((JSON.parse(raw) as { names?: unknown })?.names)
  } catch {
    return []
  }
}

async function writeP4WorkspaceOrder(names: string[]): Promise<void> {
  await fs.mkdir(path.dirname(p4WorkspaceOrderPath()), { recursive: true })
  await fs.writeFile(p4WorkspaceOrderPath(), JSON.stringify({ names }, null, 2), 'utf-8')
}

/**
 * 净化单个 label 与 labels 映射的逻辑已抽到 ./p4Labels.ts（纯函数，便于单测）。
 * 此处保留 HEX_COLOR / MAX_BADGE_LENGTH 仅供 quick-dirs:set 处理器净化徽标使用。
 */
async function readP4WorkspaceLabels(): Promise<WorkspaceLabels> {
  try {
    const raw = await fs.readFile(p4WorkspaceLabelsPath(), 'utf-8')
    return sanitizeLabelsMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

async function writeP4WorkspaceLabels(labels: WorkspaceLabels): Promise<void> {
  await fs.mkdir(path.dirname(p4WorkspaceLabelsPath()), { recursive: true })
  await fs.writeFile(p4WorkspaceLabelsPath(), JSON.stringify(labels, null, 2), 'utf-8')
}

async function readStore(): Promise<QuickDirsStore> {
  try {
    const raw = await fs.readFile(storePath(), 'utf-8')
    const parsed = JSON.parse(raw) as QuickDirsStore
    if (!Array.isArray(parsed.directories)) return { directories: [] }
    return parsed
  } catch {
    return { directories: [] }
  }
}

async function writeStore(store: QuickDirsStore): Promise<void> {
  await fs.mkdir(path.dirname(storePath()), { recursive: true })
  await fs.writeFile(storePath(), JSON.stringify(store, null, 2), 'utf-8')
}

export type UiPreferences = Record<string, string | number | boolean>

/**
 * 读取 UI 偏好。
 * 说明：不用 renderer 的 localStorage —— 生产构建以 file:// 加载页面，
 * 该 origin 下的 localStorage 不保证持久化，重启后视图偏好会丢失。
 */
async function readUiPrefs(): Promise<UiPreferences> {
  try {
    const raw = await fs.readFile(uiPrefsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: UiPreferences = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result[key] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

async function writeUiPrefs(prefs: UiPreferences): Promise<void> {
  await fs.mkdir(path.dirname(uiPrefsPath()), { recursive: true })
  await fs.writeFile(uiPrefsPath(), JSON.stringify(prefs, null, 2), 'utf-8')
}

/** 只接受标量，避免函数/大对象/循环引用进入持久化文件 */
function isScalarPref(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/* ---------- P4 ---------- */

export interface P4WorkspaceSnapshot {
  available: boolean
  /** P4PORT */
  port?: string
  user?: string
  /** P4CLIENT：当前默认工作区 */
  client?: string
  /** P4CHARSET，打开 P4V 时透传（-C） */
  charset?: string
  workspaces: P4Workspace[]
  /** 根目录不在本机的 client 数量（含 linux 路径 / 服务器临时 client） */
  hiddenCount?: number
  error?: string
}

const P4_SET_TIMEOUT_MS = 8000
const P4_CLIENTS_TIMEOUT_MS = 20000

/** 优先用安装目录下的绝对路径：Electron 从资源管理器启动时 PATH 可能尚未刷新 */
function resolveP4Executable(): string | null {
  const candidates: string[] = []
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  candidates.push(path.join(programFiles, 'Perforce', 'p4.exe'))
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFilesX86) candidates.push(path.join(programFilesX86, 'Perforce', 'p4.exe'))
  candidates.push('p4') // 兜底：依赖 PATH
  return candidates.find((c) => c === 'p4' || existsSync(c)) ?? null
}

/** p4v.exe 与 p4 同目录安装（标准安装器布局） */
function resolveP4VExecutable(): string | null {
  const candidates: string[] = []
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  candidates.push(path.join(programFiles, 'Perforce', 'p4v.exe'))
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFilesX86) candidates.push(path.join(programFilesX86, 'Perforce', 'p4v.exe'))
  candidates.push('p4v') // 兜底：依赖 PATH
  return candidates.find((c) => c === 'p4v' || existsSync(c)) ?? null
}

/**
 * 解析 p4vc 启动器（随 P4V 安装包提供，Windows 下是 p4vc.bat）。
 * 优先用 p4vc 而不是 p4v.exe：只有 p4vc 形态支持 `-s` 直接定位到文件/目录。
 * 安装位置因人而异（自定义安装目录 / 便携版），因此按以下顺序找：
 *   1. 环境变量 P4VC_PATH（用户显式指定，适配非标准安装）
 *   2. Program Files / Program Files (x86) 下的 Perforce\p4vc.bat
 *   3. PATH 查找（Windows 用 where，其他平台用 which）
 */
function resolveP4VCLauncher(): string | null {
  const candidates: string[] = []
  const custom = process.env.P4VC_PATH?.trim()
  if (custom) candidates.push(custom)
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  candidates.push(path.join(programFiles, 'Perforce', 'p4vc.bat'))
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFilesX86) candidates.push(path.join(programFilesX86, 'Perforce', 'p4vc.bat'))

  const found = candidates.find((c) => existsSync(c))
  if (found) return found

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const result = spawnSync(cmd, ['p4vc'], { encoding: 'utf8', windowsHide: true })
    if (result.status === 0 && typeof result.stdout === 'string') {
      const first = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      if (first) return first
    }
  } catch {
    /* 查找失败则回退 p4v.exe */
  }
  return null
}

/**
 * 启动常驻 GUI 进程（不等待退出）。
 * .bat / .cmd 不能由 Node 直接执行，必须经 cmd.exe 包装；
 * 包装方式见 buildWindowsBatchCommand（整条命令再包一层引号，避免 /s 剥引号导致路径被空格切断）。
 */
function spawnDetached(target: string, args: string[]): void {
  const isBatch = /\.(bat|cmd)$/i.test(target)
  const child = isBatch
    ? spawn('cmd.exe', ['/d', '/s', '/c', `"${buildWindowsBatchCommand(target, args)}"`], {
        windowsVerbatimArguments: true,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
    : spawn(target, args, { detached: true, stdio: 'ignore', windowsHide: true })
  // 启动失败（路径不存在 / 权限不足）时没有任何 UI 反馈，至少落到主进程日志里便于排查
  child.on('error', (e) => {
    console.error(`[p4v] 启动失败：${target} ${e.message}`)
  })
  child.unref()
}

function runCommand(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail =
            (typeof stderr === 'string' ? stderr : '').trim() ||
            (typeof stdout === 'string' ? stdout : '').trim() ||
            error.message
          reject(new Error(detail))
          return
        }
        resolve(typeof stdout === 'string' ? stdout : '')
      },
    )
  })
}

/** p4 的错误输出常有多行（含 usage），UI 只展示首行 */
function shortenP4Error(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const first = raw.split(/\r?\n/).find((line) => line.trim().length > 0) ?? raw
  return first.trim().slice(0, 200)
}

/*
 * 虚拟网卡识别：接口名（os.networkInterfaces() 的 Object key）在 Windows 上常被重命名
 *   （例如 VirtualBox Host-Only 显示为「以太网 2」），仅靠名称关键字无法可靠过滤。
 *   因此同时匹配「接口名」与「网卡驱动描述」（Windows: Get-NetAdapter.InterfaceDescription），
 *   并优先把「存在默认路由」的网卡地址作为主 IPv4。
 * 覆盖：VirtualBox Host-Only、vEthernet (WSL/Hyper-V)、VMware、Docker、OpenVPN TAP、
 *       隧道适配器、WAN Miniport、蓝牙 PAN、回环等。
 */
const VIRTUAL_NIC_KEYWORDS = [
  'virtualbox',   // VirtualBox Host-Only Ethernet Adapter
  'vbox',
  'host-only',
  'vethernet',    // Hyper-V / WSL vEthernet
  'hyper-v',
  'vmware',
  'vmnet',
  'docker',
  'wsl',
  'openvpn',
  'tap-',
  'loopback',
  'pseudo-interface',
  'tunnel',
  'isatap',
  'teredo',
  'bluetooth',
  'virtual',      // 兜底：Hyper-V Virtual Switch / Virtual Ethernet Adapter
  'miniport',     // WAN Miniport 伪接口
  'vpn',
]

/** 地址级过滤（与网卡无关，任何来源都应排除） */
function isUnusableIpv4(address: string): boolean {
  // 169.254.0.0/16 APIPA 链路本地地址：无 DHCP 时的自动地址，不代表真实局域网
  return address.startsWith('169.254.') || address.startsWith('0.')
}

function isVirtualNic(name: string, description?: string): boolean {
  const lower = name.toLowerCase()
  if (VIRTUAL_NIC_KEYWORDS.some((kw) => lower.includes(kw))) return true
  if (!description) return false
  return VIRTUAL_NIC_KEYWORDS.some((kw) => description.toLowerCase().includes(kw))
}

export interface NicMeta {
  description: string
  /** 该网卡是否承载默认路由（0.0.0.0/0） */
  isDefaultRoute: boolean
}

const NIC_META_TTL_MS = 5 * 60 * 1000
let nicMetaCache: { at: number; map: Map<string, NicMeta> } | null = null
let nicMetaPending: Promise<Map<string, NicMeta>> | null = null

function resolvePowerShell(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const full = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(full) ? full : 'powershell'
}

/** reg.exe 与 PowerShell 同目录，优先用绝对路径（PATH 可能被精简） */
function resolveReg(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const full = path.join(systemRoot, 'System32', 'reg.exe')
  return existsSync(full) ? full : 'reg'
}

/*
 * 读取系统代码页（ACP / OEMCP / MACCP）。
 * 「设置编码格式（需要以管理员运行）.bat」把这三个值改成 65001，这里只读不写，
 * 失败时返回空对象，由 evaluateEncoding 判定为「未设置 → 非 UTF-8」。
 */
async function readCodePages(): Promise<CodePageValues> {
  try {
    return parseRegQueryOutput(await runCommand(resolveReg(), ['query', CODE_PAGE_REG_KEY], 5000))
  } catch {
    return {}
  }
}

/**
 * 以管理员权限启动目标程序（UAC 提权）。
 * Electron 的 shell.openPath 不支持 runas，因此借 PowerShell 的 Start-Process -Verb RunAs。
 * 提权窗口会阻塞等待用户确认，故 detached 启动后立即返回，不等待结果。
 */
function launchElevated(target: string): void {
  const script = `Start-Process -FilePath '${target.replace(/'/g, "''")}' -Verb RunAs`
  const child = spawn(
    resolvePowerShell(),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { detached: true, stdio: 'ignore', windowsHide: true },
  )
  child.on('error', () => {
    /* 启动失败无需向上抛：UI 已提示脚本路径，用户可手动执行 */
  })
  child.unref()
}

/*
 * 查询 Windows 网卡描述与默认路由归属（PowerShell，结果缓存 5 分钟）。
 * 失败时返回空 Map，调用方退化为「仅按接口名过滤」，不会阻断主流程。
 */
function queryWindowsNicMeta(): Promise<Map<string, NicMeta>> {
  const script = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    '$route = Get-NetRoute -DestinationPrefix \'0.0.0.0/0\' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1',
    '$defaultIndex = if ($route) { [int]$route.ifIndex } else { -1 }',
    'Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue | ForEach-Object {',
    '  $flag = if ($_.ifIndex -eq $defaultIndex) { \'1\' } else { \'0\' }',
    '  Write-Output ($_.Name + "`t" + $_.InterfaceDescription + "`t" + $flag)',
    '}',
  ].join('; ')

  return new Promise((resolve) => {
    execFile(
      resolvePowerShell(),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const map = new Map<string, NicMeta>()
        if (!error && typeof stdout === 'string') {
          for (const line of stdout.split(/\r?\n/)) {
            const parts = line.split('\t')
            if (parts.length < 2) continue
            const name = parts[0].trim()
            if (!name) continue
            map.set(name, {
              description: (parts[1] ?? '').trim(),
              isDefaultRoute: (parts[2] ?? '').trim() === '1',
            })
          }
        }
        resolve(map)
      },
    )
  })
}

function normalizeNicName(name: string): string {
  return name.trim().toLowerCase()
}

async function getNicMeta(): Promise<Map<string, NicMeta>> {
  if (process.platform !== 'win32') return new Map()
  if (nicMetaCache && Date.now() - nicMetaCache.at < NIC_META_TTL_MS) return nicMetaCache.map
  if (nicMetaPending) return nicMetaPending
  nicMetaPending = queryWindowsNicMeta().then((map) => {
    // 用规范化名称建索引，容忍名称大小写/空白差异
    const normalized = new Map<string, NicMeta>()
    for (const [name, meta] of map) normalized.set(normalizeNicName(name), meta)
    nicMetaCache = { at: Date.now(), map: normalized }
    nicMetaPending = null
    return normalized
  })
  return nicMetaPending
}

/** 供刷新按钮强制失效缓存使用 */
function invalidateNicMetaCache(): void {
  nicMetaCache = null
}

/**
 * 纯函数：给定网卡列表与网卡元数据，选出主 IPv4 与有效地址列表。
 * 规则：跳过虚拟网卡 → 跳过 APIPA 等无效地址 → 按地址去重 → 默认路由网卡的地址作为主地址。
 * 独立成函数以便单元测试覆盖（见 test/system-info.test.ts）。
 */
export function selectIpv4(
  ifaces: Record<string, os.NetworkInterfaceInfo[] | undefined>,
  meta: Map<string, NicMeta> = new Map(),
): { primary: string; list: string[] } {
  const seen = new Set<string>()
  const list: string[] = []
  let primary = ''

  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue
    const nic = meta.get(normalizeNicName(name))
    if (isVirtualNic(name, nic?.description)) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (isUnusableIpv4(entry.address)) continue
      // 同一地址可能被多个接口（或同一接口多个条目）重复上报，去重
      if (seen.has(entry.address)) continue
      seen.add(entry.address)
      list.push(entry.address)
      if (!primary && nic?.isDefaultRoute) primary = entry.address
    }
  }

  // 无默认路由归属时退化为首个可用地址；默认路由地址始终排在最前
  if (!primary) primary = list[0] ?? 'N/A'
  else if (list.length > 1 && list[0] !== primary) {
    list.splice(list.indexOf(primary), 1)
    list.unshift(primary)
  }
  return { primary, list }
}

async function collectIpv4(): Promise<{ primary: string; list: string[] }> {
  return selectIpv4(os.networkInterfaces(), await getNicMeta())
}

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  // 预热网卡元数据缓存，避免首次打开主页时等待 PowerShell 查询（约 1-2s）
  if (process.platform === 'win32') void getNicMeta()

  ipcMain.handle('system-info:get', async (_, forceRefresh = false): Promise<SystemInfo> => {
    if (forceRefresh) invalidateNicMetaCache()
    const { primary, list } = await collectIpv4()
    return {
      hostname: os.hostname(),
      ipv4: primary,
      ipv4List: list,
      platform: process.platform,
    }
  })

  /*
   * 系统编码检测（UTF-8）：
   *   1. reg query HKLM\...\Nls\CodePage → ACP / OEMCP / MACCP（脚本写入 65001）
   *   2. p4 set                          → P4CHARSET（脚本写入 utf8）
   * 任一步失败只降级对应字段（note 说明），不抛异常，避免整个面板拿不到数据。
   */
  ipcMain.handle('system-info:encoding', async (): Promise<EncodingStatus> => {
    if (process.platform !== 'win32') {
      return { ok: false, acpOk: false, note: '仅 Windows 支持编码检测' }
    }
    const codePages = await readCodePages()
    const p4 = resolveP4Executable()
    if (!p4) return evaluateEncoding(codePages)
    try {
      const env = parseP4Set(await runCommand(p4, ['set'], P4_SET_TIMEOUT_MS))
      return evaluateEncoding(codePages, { checked: true, charset: env.P4CHARSET })
    } catch {
      return evaluateEncoding(codePages)
    }
  })

  /*
   * 执行编码修复脚本：
   *   找到 stream 为 //C7/Development/Mainline 的 P4 工作区
   *   → 拼接 <root>\Design\设置编码格式（需要以管理员运行）.bat
   *   → 校验存在后以管理员权限启动（脚本自身需要管理员，并会提示重启）。
   * 只做定位与启动，不在此处修改注册表——改注册表属于脚本职责，保持单一入口。
   */
  ipcMain.handle('encoding:repair', async (): Promise<EncodingRepairResult> => {
    const p4 = resolveP4Executable()
    if (!p4) return { ok: false, error: '未检测到 p4 命令行工具' }

    let env: Record<string, string> = {}
    try {
      env = parseP4Set(await runCommand(p4, ['set'], P4_SET_TIMEOUT_MS))
    } catch {
      /* P4USER 缺失时退化为查询全部 client，不影响后续 */
    }

    let output: string
    try {
      const user = env.P4USER ?? ''
      output = await runCommand(
        p4,
        user ? ['-ztag', 'clients', '-u', user] : ['-ztag', 'clients'],
        P4_CLIENTS_TIMEOUT_MS,
      )
    } catch (e) {
      return { ok: false, error: shortenP4Error(e) }
    }

    const workspace = findMainlineWorkspace(parseTaggedClients(output))
    if (!workspace) {
      return { ok: false, error: `未找到 stream 为 ${MAINLINE_STREAM} 的 P4 工作区` }
    }

    const scriptPath = fixScriptPath(workspace.root)
    if (!existsSync(scriptPath)) {
      return { ok: false, error: '未找到修复脚本', root: workspace.root, scriptPath }
    }

    launchElevated(scriptPath)
    return { ok: true, root: workspace.root, scriptPath }
  })

  ipcMain.handle('quick-dirs:get', async (): Promise<QuickDirectory[]> => {
    const store = await readStore()
    return store.directories.slice(0, MAX_DIRECTORIES)
  })

  ipcMain.handle('quick-dirs:set', async (_, dirs: QuickDirectory[]): Promise<QuickDirectory[]> => {
    const cleaned = (dirs ?? [])
      .filter((d) => d && typeof d.path === 'string' && d.path.trim().length > 0)
      .slice(0, MAX_DIRECTORIES)
      .map((d, idx): QuickDirectory => {
        const item: QuickDirectory = {
          id: d.id?.trim() || `dir-${Date.now()}-${idx}`,
          name: (d.name?.trim() || d.path).slice(0, 40),
          path: d.path.trim(),
        }
        // 仅接受合法 #rrggbb，避免任意字符串进入持久化数据
        if (typeof d.color === 'string' && HEX_COLOR.test(d.color.trim())) {
          item.color = d.color.trim().toLowerCase()
        }
        const badge = typeof d.badge === 'string' ? d.badge.trim().slice(0, MAX_BADGE_LENGTH) : ''
        if (badge.length > 0) item.badge = badge
        return item
      })
    await writeStore({ directories: cleaned })
    return cleaned
  })

  ipcMain.handle('ui-prefs:get', async (): Promise<UiPreferences> => readUiPrefs())

  ipcMain.handle(
    'ui-prefs:set',
    async (_, patch: Record<string, unknown>): Promise<UiPreferences> => {
      const current = await readUiPrefs()
      const next: UiPreferences = { ...current }
      for (const [key, value] of Object.entries(patch ?? {})) {
        if (key.length === 0 || key.length > UI_PREF_MAX_KEY_LENGTH) continue
        if (value === undefined || value === null) {
          delete next[key]
          continue
        }
        if (!isScalarPref(value)) continue
        if (typeof value === 'string' && value.length > UI_PREF_MAX_VALUE_LENGTH) continue
        // 键数量无界增长会让偏好文件膨胀，超限则不再接受新键
        if (!(key in next) && Object.keys(next).length >= UI_PREF_MAX_KEYS) continue
        next[key] = value
      }
      await writeUiPrefs(next)
      return next
    },
  )

  /*
   * 常用网站：只持久化用户侧配置（顺序 / 隐藏 / 自定义站点），
   * 内置站点清单在渲染层（src/features/websites/presets.ts），不进磁盘。
   */
  ipcMain.handle('websites:get', async (): Promise<WebsiteConfig> => readWebsitesConfig())

  ipcMain.handle('websites:set', async (_, config: unknown): Promise<WebsiteConfig> => {
    const cleaned = sanitizeWebsiteConfig(config)
    await writeWebsitesConfig(cleaned)
    return cleaned
  })

  /** 在系统默认浏览器中打开站点：只放行 http/https */
  ipcMain.handle(
    'web:open-external',
    async (_, url: string): Promise<{ ok: boolean; error?: string }> => {
      const normalized = normalizeWebsiteUrl(url)
      if (!normalized) return { ok: false, error: '链接无效，仅支持 http/https' }
      try {
        await shell.openExternal(normalized)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  /** 探测路径类型（拖拽落盘校验用）：只返回最小必要信息，不暴露目录内容 */
  ipcMain.handle('path:stat', async (_, targetPath: string): Promise<PathStat> => {
    if (!targetPath || typeof targetPath !== 'string') {
      return { path: '', name: '', exists: false, isDirectory: false }
    }
    const normalized = targetPath.trim()
    const name = path.basename(normalized)
    try {
      const stat = await fs.stat(normalized)
      return { path: normalized, name, exists: true, isDirectory: stat.isDirectory() }
    } catch {
      return { path: normalized, name, exists: false, isDirectory: false }
    }
  })

  /** 通用「在资源管理器中打开路径」：常用目录与 P4 工作区共用 */
  ipcMain.handle('path:open', async (_, targetPath: string): Promise<{ ok: boolean; error?: string }> => {
    if (!targetPath || typeof targetPath !== 'string') {
      return { ok: false, error: 'Invalid path' }
    }
    const abs = path.resolve(targetPath)
    if (!existsSync(abs)) {
      return { ok: false, error: 'Path does not exist' }
    }
    const result = await shell.openPath(abs)
    if (result && result.length > 0) {
      return { ok: false, error: result }
    }
    return { ok: true }
  })

  /*
   * P4 本地工作区：
   *   1. p4 set        → P4PORT / P4USER / P4CLIENT（含注册表来源）
   *   2. p4 -ztag clients -u <user> → 该用户名下所有 client 及其 Root / Stream
   *   3. 只保留根目录在本机存在的工作区（即"本地"工作区）
   * 任一步失败都返回 available=false + error，由 UI 展示降级提示，不抛异常。
   */
  ipcMain.handle('p4:workspaces', async (): Promise<P4WorkspaceSnapshot> => {
    const p4 = resolveP4Executable()
    if (!p4) {
      return { available: false, workspaces: [], error: '未检测到 p4 命令行工具' }
    }

    let env: Record<string, string> = {}
    try {
      env = parseP4Set(await runCommand(p4, ['set'], P4_SET_TIMEOUT_MS))
    } catch {
      /* p4 set 失败不影响后续，env 留空即可 */
    }

    const user = env.P4USER ?? ''
    const args = user ? ['-ztag', 'clients', '-u', user] : ['-ztag', 'clients']

    let output: string
    try {
      output = await runCommand(p4, args, P4_CLIENTS_TIMEOUT_MS)
    } catch (e) {
      return {
        available: false,
        workspaces: [],
        port: env.P4PORT,
        user: user || undefined,
        client: env.P4CLIENT,
        error: shortenP4Error(e),
      }
    }

    const records = parseTaggedClients(output)
    if (records.length === 0) {
      return {
        available: false,
        workspaces: [],
        port: env.P4PORT,
        user: user || undefined,
        client: env.P4CLIENT,
        error: output.trim().split(/\r?\n/)[0]?.slice(0, 200) || '未能解析 p4 clients 输出',
      }
    }

    const { workspaces, hiddenCount } = selectLocalWorkspaces(records, (target) => {
      try {
        return existsSync(target)
      } catch {
        return false
      }
    })

    return {
      available: true,
      port: env.P4PORT,
      user: user || undefined,
      client: env.P4CLIENT,
      charset: env.P4CHARSET,
      workspaces,
      hiddenCount,
    }
  })

  /* P4 星标（收藏）：按 client 名存取，净化在 normalizeFavoriteNames 内完成 */
  ipcMain.handle('p4-favorites:get', async (): Promise<string[]> => readP4Favorites())

  ipcMain.handle('p4-favorites:set', async (_, names: unknown): Promise<string[]> => {
    const cleaned = normalizeFavoriteNames(names)
    await writeP4Favorites(cleaned)
    return cleaned
  })

  /*
   * P4 工作区自定义排序：存一份用户拖动后的 client 名顺序列表。
   * 渲染层读取后，按此列表重排快照结果，未列入的按默认名称序追加在后。
   * 与 favorites 同样用 normalizeFavoriteNames 净化（去重 / 限量 / 长度截断）。
   */
  ipcMain.handle('p4-workspace-order:get', async (): Promise<string[]> => readP4WorkspaceOrder())

  ipcMain.handle(
    'p4-workspace-order:set',
    async (_, names: unknown): Promise<string[]> => {
      const cleaned = normalizeFavoriteNames(names)
      await writeP4WorkspaceOrder(cleaned)
      return cleaned
    },
  )

  /*
   * P4 工作区徽标自定义：client 名 → {badge?, color?}。
   * 渲染层把用户为某 client 设置的徽标文字/颜色存到这里，只读快照不变，
   * 渲染时按 client 名查表覆盖派生值。空 label 由主进程删除键，避免空条目膨胀。
   */
  ipcMain.handle(
    'p4-workspace-labels:get',
    async (): Promise<WorkspaceLabels> => readP4WorkspaceLabels(),
  )

  ipcMain.handle(
    'p4-workspace-labels:set',
    async (_, labels: unknown): Promise<WorkspaceLabels> => {
      const cleaned = sanitizeLabelsMap(labels)
      await writeP4WorkspaceLabels(cleaned)
      return cleaned
    },
  )

  /*
   * 在 P4V 中打开指定 workspace，可选直接定位到某个文件/目录（-s）：
   *   p4vc.bat [-p port] [-u user] -c client [-C charset] workspacewindow [-s path]
   *   p4v.exe -p4vc [-p port] [-u user] -c client [-C charset] workspacewindow [-s path]
   * workspacewindow 会为该连接打开工作区窗口，已打开则带到前台（见 p4vc help）。
   * -s 支持本地路径与 depot 路径，放在子命令之后。
   * 连接参数由 Renderer 从快照透传；p4v 是常驻 GUI 进程，detached 启动后立即返回。
   */
  ipcMain.handle(
    'p4:open-p4v',
    async (
      _,
      payload: {
        client: string
        port?: string
        user?: string
        charset?: string
        /** 要定位的文件/目录（本地或 depot 路径，对应 -s） */
        target?: string
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      const client = typeof payload?.client === 'string' ? payload.client.trim() : ''
      if (!client) return { ok: false, error: '缺少 client 名' }
      const target = typeof payload?.target === 'string' ? payload.target.trim() : ''
      // 优先 p4vc（只有它支持 -s 定位），找不到再回退 p4v.exe + -p4vc
      const p4vc = resolveP4VCLauncher()
      const command = p4vc ?? resolveP4VExecutable()
      if (!command) return { ok: false, error: '未检测到 p4v / p4vc（P4 图形客户端）' }
      try {
        const args = buildP4VArgs(
          { port: payload?.port, user: payload?.user, charset: payload?.charset },
          client,
          { target, viaP4vcLauncher: !!p4vc },
        )
        spawnDetached(command, args)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: shortenP4Error(e) }
      }
    },
  )

  ipcMain.handle('quick-dirs:pick', async (): Promise<{ name: string; path: string } | null> => {
    // Open a directory picker via a native dialog (deferred import to keep startup light)
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]
    return { name: path.basename(picked), path: picked }
  })

  /*
   * Redmine 单子查询：按用户名查询当前进行中、且目标版本 != 223 的单子。
   * 实现见 electron/main/redmine.ts（API Key 只存在于主进程）。
   * 渲染层通过 redmineIssues Service 调用，禁止直接 fetch 外网。
   */
  ipcMain.handle(
    'redmine:issues',
    async (_, userName?: string): Promise<RedmineIssuesSnapshot> => {
      return fetchRedmineIssues(userName ?? '')
    },
  )

  /* ---------- SSO 登录 ---------- */

  /*
   * 读取本地 SSO session（启动时回显已登录用户）.
   * session 存于 userData/sso-session.json，主进程返回纯对象，渲染层只读不写。
   */
  ipcMain.handle('sso:get-session', async (): Promise<SsoSession | null> => readSsoSession())

  /*
   * 启动 SSO 登录流程.
   * 主进程创建子 BrowserWindow 加载 SSO 登录页，拦截重定向拿 ticket，
   * 调用 /cas/serviceValidate 校验，成功后持久化 session 并返回用户名。
   * 失败/取消返回 success=false + error，由渲染层 Toast 提示。
   */
  ipcMain.handle('sso:login', async (): Promise<SsoResult> => {
    try {
      return await startSsoLogin(getMainWindow())
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      return { success: false, error }
    }
  })

  /** 登出：清除本地 session，不调用 SSO 单点登出（客户端 APP 无需 SLO） */
  ipcMain.handle('sso:logout', async (): Promise<{ ok: boolean }> => {
    await clearSsoSession()
    return { ok: true }
  })

  /* ---------- 自定义窗口控制按钮 ---------- */

  /*
   * 去掉原生 titleBarOverlay 后，最小化/最大化/关闭由渲染层自定义按钮触发，
   * 通过 IPC 转发到主进程操作窗口。getMainWindow() 延迟取值，窗口未创建时静默忽略。
   */
  ipcMain.handle('window:minimize', async (): Promise<{ ok: boolean }> => {
    const w = getMainWindow()
    if (!w || w.isDestroyed()) return { ok: false }
    w.minimize()
    return { ok: true }
  })

  ipcMain.handle('window:toggle-maximize', async (): Promise<{ ok: boolean; maximized: boolean }> => {
    const w = getMainWindow()
    if (!w || w.isDestroyed()) return { ok: false, maximized: false }
    if (w.isMaximized()) {
      w.unmaximize()
      return { ok: true, maximized: false }
    }
    w.maximize()
    return { ok: true, maximized: true }
  })

  ipcMain.handle('window:close', async (): Promise<{ ok: boolean }> => {
    const w = getMainWindow()
    if (!w || w.isDestroyed()) return { ok: false }
    w.close()
    return { ok: true }
  })

  ipcMain.handle('window:is-maximized', async (): Promise<{ maximized: boolean }> => {
    const w = getMainWindow()
    if (!w || w.isDestroyed()) return { maximized: false }
    return { maximized: w.isMaximized() }
  })

  /* ---------- Cross Branch Merge ---------- */
  /*
   * 依据 docs/CROSS_BRANCH_MERGE_TOOL_SPEC.md：
   *   - §4.1 Renderer 禁止直接执行系统命令，所有 P4 调用经 IPC
   *   - §5 P4Service 统一封装 exit code / stdout / stderr / charset / timeout / cancellation
   *   - §43 长时间运行命令支持取消（AbortController → Process.kill）
   *   - §64 Preview 只读，不修改 Workspace
   *   - §69.3 永远用 spawn(executable, args)，不拼 shell 字符串
   */

  const P4_MERGE_CHANGES_TIMEOUT_MS = 20000
  const P4_MERGE_DESCRIBE_TIMEOUT_MS = 20000
  const P4_MERGE_OPENED_TIMEOUT_MS = 15000
  const P4_MERGE_SYNC_TIMEOUT_MS = 120000
  const P4_MERGE_INTEGRATE_TIMEOUT_MS = 120000
  const P4_MERGE_RESOLVE_TIMEOUT_MS = 120000
  const P4_MERGE_CHANGE_TIMEOUT_MS = 15000

  /** 进行中的 Merge 事务：transactionId → AbortController，cancel 时 kill 子进程 */
  const activeMergeTransactions = new Map<string, AbortController>()

  /**
   * 可取消的 spawn 包装：返回 stdout/stderr/exitCode，signal abort 时 kill 子进程.
   * Node 20+ spawn 支持 signal 选项，abort 后子进程收到 SIGTERM.
   */
  function runP4Cancellable(
    p4: string,
    args: string[],
    options: { timeout: number; signal?: AbortSignal; stdin?: string },
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null; aborted: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(p4, args, {
        encoding: 'utf8',
        windowsHide: true,
        signal: options.signal,
        timeout: options.timeout,
        maxBuffer: 16 * 1024 * 1024,
      })
      let stdout = ''
      let stderr = ''
      let aborted = false

      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf8') })
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf8') })

      if (options.stdin) {
        try {
          child.stdin?.write(options.stdin, 'utf8')
          child.stdin?.end()
        } catch {
          /* 写入失败由后续 exit code 捕获，不阻断 */
        }
      }

      const onAbort = () => {
        aborted = true
        try {
          if (!child.killed) {
            // Windows 下 SIGTERM 等价于强制结束；tree kill 避免残留子进程
            if (process.platform === 'win32') {
              try {
                process.kill(child.pid ?? 0)
              } catch {
                /* pid 失效则忽略 */
              }
            } else {
              child.kill('SIGTERM')
            }
          }
        } catch {
          /* kill 失败忽略，等待 close 事件 */
        }
      }
      if (options.signal) {
        if (options.signal.aborted) onAbort()
        else options.signal.addEventListener('abort', onAbort, { once: true })
      }

      child.on('error', () => {
        resolve({ stdout, stderr, exitCode: -1, aborted: true })
      })
      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code, aborted })
      })
    })
  }

  /**
   * 查已提交 changelist（spec §8）.
   * 命令：`p4 -ztag changes -c <client> -s submitted -m <limit> [-u <user>]`
   *
   * 关键点（踩过的坑）：
   *   1. 必须加 `-ztag`：默认输出是 `Change 2137156 on ... by user@client 'desc'` 单行文本，
   *      parseTaggedChanges 只认 `... change` 开头的 ztag 格式.
   *   2. `-c <client>` 必须放在 `changes` 之后作为子选项：全局 `-c` 只设置 P4CLIENT，
   *      对 `changes` 命令无过滤作用；作为子选项才按 client 过滤（p4 changes 文档）.
   *   3. ztag 字段名是 `desc`（单行）与 `time`（unix 秒），不是 `description` / `date`；
   *      完整多行描述需 `p4 describe`（见 p4-merge:describe handler）.
   */
  ipcMain.handle(
    'p4-merge:changes',
    async (_, payload: { client: string; user?: string; limit?: number }): Promise<{
      ok: boolean
      changes?: P4Changelist[]
      error?: string
    }> => {
      const p4 = resolveP4Executable()
      if (!p4) return { ok: false, error: '未检测到 p4 命令行工具' }
      const client = payload?.client?.trim()
      if (!client) return { ok: false, error: '缺少 source workspace client' }
      const limit = Math.max(1, Math.min(payload?.limit ?? 50, 500))
      try {
        // -L：显示完整描述（默认只给首行，会截断导致 Redmine 单号丢失）
        const args = ['-ztag', 'changes', '-c', client, '-s', 'submitted', '-L', '-m', String(limit)]
        if (payload?.user) args.push('-u', payload.user)
        const out = await runCommand(p4, args, P4_MERGE_CHANGES_TIMEOUT_MS)
        return { ok: true, changes: parseTaggedChanges(out) }
      } catch (e) {
        return { ok: false, error: shortenP4Error(e) }
      }
    },
  )

  /** p4 describe -s <change>：拿文件列表 / Action / Revision / Description（spec §9） */
  ipcMain.handle(
    'p4-merge:describe',
    async (_, payload: { change: number; client?: string }): Promise<{
      ok: boolean
      change?: number
      description?: string
      files?: P4ChangeFile[]
      error?: string
    }> => {
      const p4 = resolveP4Executable()
      if (!p4) return { ok: false, error: '未检测到 p4 命令行工具' }
      const change = Number(payload?.change)
      if (!Number.isFinite(change) || change <= 0) return { ok: false, error: '无效的 changelist 编号' }
      try {
        const args = payload?.client ? ['-c', payload.client] : []
        args.push('describe', '-s', String(change))
        const out = await runCommand(p4, args, P4_MERGE_DESCRIBE_TIMEOUT_MS)
        const parsed = parseDescribeOutput(out)
        return { ok: true, ...parsed }
      } catch (e) {
        return { ok: false, error: shortenP4Error(e) }
      }
    },
  )

  /** p4 opened -C <client>：检查目标 workspace 是否有未提交修改（spec §15） */
  ipcMain.handle(
    'p4-merge:opened',
    async (_, payload: { client: string; files?: string[] }): Promise<{
      ok: boolean
      opened?: P4OpenedFile[]
      error?: string
    }> => {
      const p4 = resolveP4Executable()
      if (!p4) return { ok: false, error: '未检测到 p4 命令行工具' }
      const client = payload?.client?.trim()
      if (!client) return { ok: false, error: '缺少 target workspace client' }
      try {
        // 参数构造见 buildOpenedArgs：`-C` 必须在子命令后，且不能用 `-a`（全服语义）
        const args = buildOpenedArgs({ client, files: payload?.files })
        const out = await runCommand(p4, args, P4_MERGE_OPENED_TIMEOUT_MS)
        return { ok: true, opened: parseOpenedOutput(out) }
      } catch (e) {
        // p4 opened 在没有打开文件时返回非 0 退出码 + "no open files" 文案，视作空列表
        const msg = e instanceof Error ? e.message : String(e)
        if (/no file\(s\) opened|no opened/i.test(msg)) return { ok: true, opened: [] }
        return { ok: false, error: shortenP4Error(e) }
      }
    },
  )

  /** Merge Tool Registry 实例（默认工具 + 后续可扩展配置文件） */
  const mergeToolRegistry = new MergeToolRegistry([
    {
      id: 'p4merge',
      name: 'P4Merge',
      executable: '',
      extensions: ['.lua', '.json', '.ini', '.cfg', '.xml', '.txt', '.md', '.csv', '.ts', '.js', '.cs'],
      arguments: '%b %1 %2 %r',
      priority: 10,
      successExitCodes: [0],
      cancelExitCodes: [1],
    },
    {
      id: 'key-excel-merge',
      name: 'KeyExcelMerge',
      executable: 'Design/Tool/KeyExcelMergeTool/KeyExcelMerge/KeyExcelMerge.exe',
      extensions: ['.xlsx', '.xlsm', '.xls'],
      arguments: '%b %1 %2 %r VCSTool=p4',
      priority: 5,
      successExitCodes: [0],
      cancelExitCodes: [1],
    },
  ])

  ipcMain.handle('p4-merge:merge-tools', async (): Promise<{ tools: MergeTool[] }> => ({
    tools: mergeToolRegistry.list(),
  }))

  /** 计算 Preview（spec §64 纯只读，不修改 Workspace）：本地推导文件映射 + 工具命中 */
  ipcMain.handle(
    'p4-merge:preview',
    async (_, payload: {
      sourceWorkspace: string
      targetWorkspace: string
      sourceChange: number
      mapping: BranchMapping
      changeFiles: P4ChangeFile[]
    }): Promise<{ ok: boolean; preview?: MergePreview; error?: string }> => {
      try {
        const preview = computeMergePreview({
          sourceWorkspace: payload.sourceWorkspace,
          targetWorkspace: payload.targetWorkspace,
          sourceChange: payload.sourceChange,
          mapping: payload.mapping,
          changeFiles: payload.changeFiles,
          registry: mergeToolRegistry,
        })
        return { ok: true, preview }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  /** 推送进度事件到渲染层：webContents.send('p4-merge:progress', payload) */
  const emitProgress = (transactionId: string, step: PipelineStepId, patch: Partial<PipelineStepState>) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send('p4-merge:progress', { transactionId, step, patch })
  }

  /**
   * 创建 Pending Changelist：`p4 -c <client> change -o` 取模板 → 替换 Description → `p4 change -i`.
   * 注意 Description 是模板**最后一个**字段，替换方式见 replaceChangeFormDescription 的注释.
   */
  async function createPendingChange(
    p4: string,
    client: string,
    description: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; change?: number; error?: string }> {
    try {
      const outForm = await runP4Cancellable(p4, ['-c', client, 'change', '-o'], {
        timeout: P4_MERGE_CHANGE_TIMEOUT_MS,
        signal,
      })
      if (outForm.aborted || outForm.exitCode !== 0) {
        return { ok: false, error: shortenP4Error(outForm.stderr || outForm.stdout || 'p4 change -o 失败') }
      }
      const form = outForm.stdout
      const replaced = replaceChangeFormDescription(form, description)
      // 原样返回 = 模板里没找到 Description 字段；此时回灌必然报
      // "Error in change specification."，提前给出可定位的错误
      if (replaced === form) {
        return { ok: false, error: 'p4 change -o 模板中未找到 Description 字段，无法创建 Pending CL' }
      }
      const submit = await runP4Cancellable(p4, ['-c', client, 'change', '-i'], {
        timeout: P4_MERGE_CHANGE_TIMEOUT_MS,
        signal,
        stdin: replaced,
      })
      if (submit.aborted || submit.exitCode !== 0) {
        // p4 首行常是笼统的 "Error in change specification."，真正原因在最后一行
        const detail = summarizeP4Error(submit.stderr || submit.stdout) || 'p4 change -i 失败'
        return { ok: false, error: detail }
      }
      // 输出："Change <num> created."
      const m = submit.stdout.match(/Change\s+(\d+)\s+created/i)
      return m ? { ok: true, change: Number(m[1]) } : { ok: true }
    } catch (e) {
      return { ok: false, error: shortenP4Error(e) }
    }
  }

  /**
   * 执行 Merge 流程（spec §16/§26/§71）：
   *   preflight → sync → pending → integrate → resolve → result
   * 全程通过 'p4-merge:progress' 事件推送每步状态，渲染层据此更新管线.
   * 不自动 submit（spec §29）；不自动 revert/clean（spec §44）.
   */
  ipcMain.handle(
    'p4-merge:execute',
    async (
      _,
      payload: {
        sourceClient: string
        targetClient: string
        sourceChange: number
        sourceDescription: string
        mapping: BranchMapping
        user: string
        files: { sourcePath: string; targetPath: string; sourceRevision?: number }[]
        syncMode: 'file' | 'directory'
        /** 用户确认后置 true：先 revert 重叠已打开文件再继续（见 service 层 ExecuteMergeParams） */
        revertOverlapping?: boolean
      },
    ): Promise<{
      ok: boolean
      transactionId?: string
      targetChange?: number
      error?: string
      needConfirm?: boolean
      overlappingOpened?: P4OpenedFile[]
    }> => {
      const p4 = resolveP4Executable()
      if (!p4) return { ok: false, error: '未检测到 p4 命令行工具' }
      const sourceClient = payload?.sourceClient?.trim()
      const targetClient = payload?.targetClient?.trim()
      if (!sourceClient || !targetClient) return { ok: false, error: '缺少 source/target workspace' }
      if (sourceClient === targetClient) {
        return { ok: false, error: '源 Workspace 与目标 Workspace 相同，无法执行跨分支 Merge' }
      }
      if (!payload.files || payload.files.length === 0) {
        return { ok: false, error: '没有需要 merge 的文件' }
      }

      const transactionId = generateTransactionId()
      const controller = new AbortController()
      activeMergeTransactions.set(transactionId, controller)

      const pipeline = createInitialPipeline()
      const setStep = (id: PipelineStepId, patch: Partial<PipelineStepState>) => {
        const idx = pipeline.findIndex((s) => s.id === id)
        if (idx >= 0) {
          pipeline[idx] = { ...pipeline[idx], ...patch, logs: patch.logs ?? pipeline[idx].logs }
          emitProgress(transactionId, id, pipeline[idx])
        }
      }
      const pushLog = (id: PipelineStepId, line: string) => {
        const idx = pipeline.findIndex((s) => s.id === id)
        if (idx >= 0) {
          pipeline[idx] = { ...pipeline[idx], logs: [...pipeline[idx].logs, line] }
          emitProgress(transactionId, id, pipeline[idx])
        }
      }

      try {
        /* Step 1: Preflight —— 检查目标 workspace 已打开文件，区分「与本次 Merge 重叠」与「无关」两类：
         *   - 无关已打开文件（不在本次 Merge 的 target 路径集合内）：直接阻断，这是别人的 WIP，不能动；
         *   - 重叠已打开文件（恰好是本次 Merge 要 integrate 的目标）：
         *       · 首次调用（revertOverlapping 未传）：返回 needConfirm + 文件列表，让 UI 弹确认；
         *       · 用户确认后带 revertOverlapping=true 重跑：先 p4 revert 这些文件再继续；
         *   - 完全干净：直接进入 Sync.
         * 这样既保护无关 WIP 不被误改，又让「目标 CL 里残留上次半 merge 的文件」这种常见情况能一键继续. */
        setStep('preflight', { status: 'running', startedAt: Date.now() })
        pushLog('preflight', `Target: ${targetClient}`)
        const openedRes = await runP4Cancellable(
          p4,
          buildOpenedArgs({ client: targetClient }),
          { timeout: P4_MERGE_OPENED_TIMEOUT_MS, signal: controller.signal },
        )
        if (openedRes.aborted) {
          setStep('preflight', { status: 'failed', error: '已取消', endedAt: Date.now() })
          return { ok: false, transactionId, error: '已取消' }
        }
        const opened = parseOpenedOutput(openedRes.stdout)
        const targetPathSet = new Set(payload.files.map((f) => f.targetPath))
        const overlapping = opened.filter((o) => targetPathSet.has(o.depotPath))
        const otherOpened = opened.filter((o) => !targetPathSet.has(o.depotPath))

        // 1a: 无关已打开文件 —— 直接阻断（保护别人的 WIP）
        if (otherOpened.length > 0) {
          const samples = otherOpened
            .slice(0, 3)
            .map((f) => `${f.depotPath}${f.client ? ` @${f.client}` : ''}`)
            .join('、')
          pushLog('preflight', `检测到 ${otherOpened.length} 个与本次 Merge 无关的已打开文件：${samples}${otherOpened.length > 3 ? ' …' : ''}`)
          setStep('preflight', { status: 'failed', error: '目标 Workspace 存在与本次 Merge 无关的未提交修改', endedAt: Date.now() })
          return {
            ok: false,
            transactionId,
            error: `目标 Workspace 存在 ${otherOpened.length} 个与本次 Merge 无关的未提交文件，请先处理后再执行 Merge`,
          }
        }

        // 1b: 重叠已打开文件 —— 需要用户确认
        if (overlapping.length > 0 && !payload.revertOverlapping) {
          const samples = overlapping
            .slice(0, 5)
            .map((f) => `${f.depotPath}${f.change && f.change !== 'default' ? ` @${f.change}` : ''}`)
            .join('、')
          pushLog('preflight', `检测到 ${overlapping.length} 个文件已在目标 Pending CL 中打开：${samples}${overlapping.length > 5 ? ' …' : ''}`)
          setStep('preflight', { status: 'failed', error: '检测到重叠已打开文件，等待用户确认是否 Revert', endedAt: Date.now() })
          return {
            ok: false,
            transactionId,
            error: `目标 Workspace 的 Pending CL 中已有 ${overlapping.length} 个本次 Merge 涉及的文件，需确认是否 Revert 后继续`,
            needConfirm: true,
            overlappingOpened: overlapping,
          }
        }

        // 1c: 用户已确认（revertOverlapping=true）—— revert 重叠文件后继续
        if (overlapping.length > 0 && payload.revertOverlapping) {
          const revertFiles = overlapping.map((o) => o.depotPath)
          pushLog('preflight', `Revert ${revertFiles.length} 个重叠文件：p4 -c ${targetClient} revert <files>`)
          const revertRes = await runP4Cancellable(
            p4,
            buildRevertArgs({ targetClient, files: revertFiles }),
            { timeout: P4_MERGE_SYNC_TIMEOUT_MS, signal: controller.signal },
          )
          if (revertRes.aborted) {
            setStep('preflight', { status: 'failed', error: '已取消', endedAt: Date.now() })
            return { ok: false, transactionId, error: '已取消' }
          }
          if (revertRes.exitCode !== 0) {
            const msg = summarizeP4Error(revertRes.stderr || revertRes.stdout)
            pushLog('preflight', `Revert 失败：${msg}`)
            setStep('preflight', { status: 'failed', error: msg, endedAt: Date.now() })
            return { ok: false, transactionId, error: `Revert 失败：${msg}` }
          }
          pushLog('preflight', `Revert 完成（${revertFiles.length} 个文件）`)
        }

        pushLog('preflight', '目标 Workspace 干净')
        setStep('preflight', { status: 'success', endedAt: Date.now() })

        /* Step 2: Sync —— 最小范围 Sync（spec §13/§14），file 或 directory 模式，不再支持 manual */
        setStep('sync', { status: 'running', startedAt: Date.now() })
        {
          const mode = payload.syncMode === 'directory' ? 'directory' : 'file'
          const targetFiles = payload.files.map((f) => f.targetPath)
          pushLog('sync', `p4 -c ${targetClient} sync (${mode}, ${targetFiles.length} files)`)
          const syncRes = await runP4Cancellable(
            p4,
            buildSyncArgs({ targetClient, files: targetFiles, mode }),
            {
              timeout: P4_MERGE_SYNC_TIMEOUT_MS,
              signal: controller.signal,
            },
          )
          if (syncRes.aborted) {
            setStep('sync', { status: 'failed', error: '已取消', endedAt: Date.now() })
            return { ok: false, transactionId, error: '已取消' }
          }
          if (syncRes.exitCode !== 0 && !/up-to-date/i.test(syncRes.stderr)) {
            setStep('sync', { status: 'failed', error: shortenP4Error(syncRes.stderr || syncRes.stdout), endedAt: Date.now() })
            return { ok: false, transactionId, error: `Sync 失败：${shortenP4Error(syncRes.stderr || syncRes.stdout)}` }
          }
          pushLog('sync', `Sync 完成（${mode}）`)
          setStep('sync', { status: 'success', endedAt: Date.now() })
        }

        /* Step 3: Pending CL —— 创建目标 Pending Changelist（spec §18） */
        setStep('pending', { status: 'running', startedAt: Date.now() })
        const desc = buildPendingChangeDescription({
          sourceBranch: payload.mapping.source,
          sourceChange: payload.sourceChange,
          targetBranch: payload.mapping.target,
          user: payload.user || 'unknown',
          sourceDescription: payload.sourceDescription || '',
        })
        pushLog('pending', `创建 Pending CL：merge ${payload.sourceDescription || payload.sourceChange}`)
        const pendingRes = await createPendingChange(p4, targetClient, desc, controller.signal)
        if (!pendingRes.ok || !pendingRes.change) {
          const reason = pendingRes.error ?? '创建 Pending CL 失败'
          pushLog('pending', `创建失败：${reason}`)
          setStep('pending', { status: 'failed', error: reason, endedAt: Date.now() })
          return { ok: false, transactionId, error: reason }
        }
        const targetChange = pendingRes.change
        pushLog('pending', `Pending CL #${targetChange} 已创建`)
        setStep('pending', { status: 'success', endedAt: Date.now() })

        /* Step 4: Integrate —— 逐文件执行 p4 integrate -c <targetChange> <source>#<rev> <target>
         * 原因：p4 integrate 的 `fromFile toFile` 形式一次只接受一对具体文件（见
         * buildIntegrateArgs 注释），多对路径塞同一条命令会让 p4 解析失败并打印 Usage.
         * 逐文件执行虽启动多次 p4 进程，但跨分支 Merge 文件数通常很少（几个到几十个），
         * 且能精确定位失败文件，符合 spec §29/§44「不自动 submit/revert」的半自动定位. */
        setStep('integrate', { status: 'running', startedAt: Date.now() })
        pushLog('integrate', `p4 -c ${targetClient} integrate -c ${targetChange} (${payload.files.length} files, 逐文件执行)`)
        let integrateError: { file: string; message: string } | null = null
        let integrateOkCount = 0
        for (const file of payload.files) {
          const integrateArgs = buildIntegrateArgs({
            targetClient,
            targetChange: String(targetChange),
            file,
          })
          const integRes = await runP4Cancellable(p4, integrateArgs, {
            timeout: P4_MERGE_INTEGRATE_TIMEOUT_MS,
            signal: controller.signal,
          })
          if (integRes.aborted) {
            setStep('integrate', { status: 'failed', error: '已取消', endedAt: Date.now() })
            return { ok: false, transactionId, error: '已取消', targetChange }
          }
          if (integRes.exitCode !== 0) {
            const msg = summarizeP4Error(integRes.stderr || integRes.stdout)
            pushLog('integrate', `✗ ${file.targetPath} — ${msg}`)
            integrateError = { file: file.targetPath, message: msg }
            break
          }
          integrateOkCount += 1
          pushLog('integrate', `✓ ${file.targetPath}`)
        }
        if (integrateError) {
          const failMsg = `${integrateError.file} — ${integrateError.message}`
          setStep('integrate', { status: 'failed', error: failMsg, endedAt: Date.now() })
          return {
            ok: false,
            transactionId,
            error: `Integrate 失败：${failMsg}（已成功 ${integrateOkCount}/${payload.files.length}）`,
            targetChange,
          }
        }
        pushLog('integrate', `Integrate 完成（${payload.files.length} 个文件）`)
        setStep('integrate', { status: 'success', endedAt: Date.now() })

        /* Step 5: Resolve —— 文本走 p4 resolve -am，二进制走 p4 resolve -as 覆盖（spec §26 + §22 Binary 覆盖策略） */
        setStep('resolve', { status: 'running', startedAt: Date.now() })
        const allTargetFiles = payload.files.map((f) => f.targetPath)
        // 按扩展名拆分：二进制走 accept source 覆盖，其余走 auto merge
        const binaryFiles = payload.files
          .filter((f) => BINARY_EXTENSIONS.has(getExtension(f.targetPath)))
          .map((f) => f.targetPath)
        const textFiles = payload.files
          .filter((f) => !BINARY_EXTENSIONS.has(getExtension(f.targetPath)))
          .map((f) => f.targetPath)

        // 5a: 文本自动合并
        if (textFiles.length > 0) {
          pushLog('resolve', `p4 -c ${targetClient} resolve -am (${textFiles.length} text files)`)
          const resolveRes = await runP4Cancellable(p4, buildResolveArgs({ targetClient, files: textFiles, mode: 'auto' }), {
            timeout: P4_MERGE_RESOLVE_TIMEOUT_MS,
            signal: controller.signal,
          })
          if (resolveRes.aborted) {
            setStep('resolve', { status: 'failed', error: '已取消', endedAt: Date.now() })
            return { ok: false, transactionId, error: '已取消', targetChange }
          }
          // resolve -am 在存在冲突时会返回非 0，但不视为整体失败：后续由用户在 P4V 中手动 resolve
          if (resolveRes.exitCode !== 0) {
            const hasConflict = /conflict|merge/i.test(resolveRes.stderr + resolveRes.stdout)
            pushLog('resolve', `resolve -am 退出码 ${resolveRes.exitCode}，存在需手动处理的冲突`)
            setStep('resolve', {
              status: hasConflict ? 'success' : 'failed',
              error: hasConflict ? undefined : shortenP4Error(resolveRes.stderr || resolveRes.stdout),
              endedAt: Date.now(),
            })
            if (!hasConflict) {
              return { ok: false, transactionId, error: `Resolve 失败：${shortenP4Error(resolveRes.stderr || resolveRes.stdout)}`, targetChange }
            }
          } else {
            pushLog('resolve', `Resolve -am 完成（${textFiles.length} 个文本文件）`)
            setStep('resolve', { status: 'success', endedAt: Date.now() })
          }
        } else {
          pushLog('resolve', '无文本文件需要 auto merge')
        }

        // 5b: 二进制覆盖（accept source，用源版本覆盖目标）
        if (binaryFiles.length > 0) {
          pushLog('resolve', `p4 -c ${targetClient} resolve -as (${binaryFiles.length} binary files, accept source)`)
          const overrideRes = await runP4Cancellable(p4, buildResolveOverrideArgs({ targetClient, files: binaryFiles }), {
            timeout: P4_MERGE_RESOLVE_TIMEOUT_MS,
            signal: controller.signal,
          })
          if (overrideRes.aborted) {
            setStep('resolve', { status: 'failed', error: '已取消', endedAt: Date.now() })
            return { ok: false, transactionId, error: '已取消', targetChange }
          }
          if (overrideRes.exitCode !== 0) {
            // 二进制覆盖失败不终止整体流程，但记录警告，由用户在 P4V 手动处理
            pushLog('resolve', `⚠ 二进制覆盖退出码 ${overrideRes.exitCode}：${shortenP4Error(overrideRes.stderr || overrideRes.stdout)}`)
          } else {
            pushLog('resolve', `二进制覆盖完成（${binaryFiles.length} 个文件 accept source）`)
          }
          setStep('resolve', { status: 'success', endedAt: Date.now() })
        }

        /* Step 6: Result —— 校验目标 Pending CL 文件（-c <changelist> 已限定范围，无需 -a） */
        setStep('result', { status: 'running', startedAt: Date.now() })
        const verifyRes = await runP4Cancellable(p4, buildOpenedArgs({ client: targetClient, change: targetChange }), {
          timeout: P4_MERGE_OPENED_TIMEOUT_MS,
          signal: controller.signal,
        })
        const verifyFiles = parseOpenedOutput(verifyRes.stdout)
        pushLog('result', `目标 Pending CL #${targetChange}：${verifyFiles.length} 个文件已就绪`)
        pushLog('result', '不自动 Submit，请通过 P4V / p4 自行 Review 后提交')
        setStep('result', { status: 'success', endedAt: Date.now() })

        return { ok: true, transactionId, targetChange }
      } catch (e) {
        return { ok: false, transactionId, error: e instanceof Error ? e.message : String(e) }
      } finally {
        activeMergeTransactions.delete(transactionId)
      }
    },
  )

  /** 取消进行中的 Merge 事务：kill 子进程并标记为 cancelled（spec §43） */
  ipcMain.handle(
    'p4-merge:cancel',
    async (_, transactionId: string): Promise<{ ok: boolean }> => {
      const controller = activeMergeTransactions.get(transactionId)
      if (!controller) return { ok: false }
      controller.abort()
      activeMergeTransactions.delete(transactionId)
      return { ok: true }
    },
  )

  /**
   * 在 P4V 中打开指定 workspace，并可选定位到 Pending Changelist / 已提交 Changelist / 某个文件.
   * 复用既有 p4vc / p4v.exe 启动逻辑（buildP4VArgs），根据 payload 选择定位目标：
   *   - 有 target：p4vc -c <client> workspacewindow -s <target>（定位到文件/目录）
   *   - 有 pendingChange：p4vc -c <client> changelist <num>（打开 Pending CL 视图）
   *   - 有 change（已提交）：p4vc -c <client> change <num>（打开 submitted changelist 详情）
   *   - 都没有：p4vc -c <client> workspacewindow（只打开工作区窗口）
   * 这是辅助能力（spec §58），Merge 核心流程不依赖它.
   */
  ipcMain.handle(
    'p4-merge:open-in-p4v',
    async (
      _,
      payload: {
        client: string
        port?: string
        user?: string
        charset?: string
        pendingChange?: number
        /** 已提交 changelist 编号（用 p4vc change <num> 打开详情） */
        change?: number
        /** 要定位的文件/目录（depot 路径或本地路径，对应 p4vc -s） */
        target?: string
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      const client = payload?.client?.trim()
      if (!client) return { ok: false, error: '缺少 client 名' }
      const p4vc = resolveP4VCLauncher()
      const command = p4vc ?? resolveP4VExecutable()
      if (!command) return { ok: false, error: '未检测到 p4v / p4vc（P4 图形客户端）' }
      try {
        const args: string[] = []
        if (!p4vc) args.push('-p4vc')
        if (payload.port) args.push('-p', payload.port)
        if (payload.user) args.push('-u', payload.user)
        args.push('-c', client)
        if (payload.charset) args.push('-C', payload.charset)
        const target = payload.target?.trim()
        if (target) {
          // 定位到文件/目录：workspacewindow -s <target>
          args.push('workspacewindow', '-s', target)
        } else if (payload.pendingChange && Number.isFinite(payload.pendingChange)) {
          // 打开 Pending CL 视图
          args.push('changelist', String(payload.pendingChange))
        } else if (payload.change && Number.isFinite(payload.change)) {
          // 打开已提交 changelist 详情：p4vc change <num>
          args.push('change', String(payload.change))
        } else {
          args.push('workspacewindow')
        }
        spawnDetached(command, args)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: shortenP4Error(e) }
      }
    },
  )
}
