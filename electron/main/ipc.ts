import { app, ipcMain, shell } from 'electron'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'

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

interface QuickDirsStore {
  directories: QuickDirectory[]
}

const MAX_DIRECTORIES = 5
const STORE_FILE = 'quick-directories.json'
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const MAX_BADGE_LENGTH = 2

function storePath(): string {
  return path.join(app.getPath('userData'), STORE_FILE)
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

export function registerIpcHandlers(): void {
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

  ipcMain.handle('quick-dirs:open', async (_, targetPath: string): Promise<{ ok: boolean; error?: string }> => {
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
}
