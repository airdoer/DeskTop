import { app, ipcMain, shell } from 'electron'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'

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
}

interface QuickDirsStore {
  directories: QuickDirectory[]
}

const MAX_DIRECTORIES = 5
const STORE_FILE = 'quick-directories.json'

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
 * 虚拟网卡识别：通过接口名关键字（小写匹配）排除常见虚拟适配器。
 * 覆盖：VirtualBox Host-Only、vEthernet (WSL/Hyper-V)、VMware、Docker、
 *       OpenVPN TAP、隧道适配器、回环等。
 * 注意：接口名在 Windows 上由 os.networkInterfaces() 的 Object key 提供。
 */
const VIRTUAL_NIC_KEYWORDS = [
  'vethernet',    // Hyper-V / WSL vEthernet
  'virtualbox',   // VirtualBox Host-Only
  'vmware',       // VMware adapter
  'hyper-v',      // Hyper-V virtual switch
  'docker',       // Docker network
  'wsl',          // WSL
  'openvpn',      // OpenVPN TAP
  'tap-',         // TAP adapter
  'loopback',     // loopback
  'tunnel',       // 隧道适配器
  'isatap',       // ISATAP 隧道
  'teredo',       // Teredo 隧道
]

function isVirtualNic(name: string): boolean {
  const lower = name.toLowerCase()
  return VIRTUAL_NIC_KEYWORDS.some((kw) => lower.includes(kw))
}

function collectIpv4(): { primary: string; list: string[] } {
  const ifaces = os.networkInterfaces()
  const list: string[] = []
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue
    if (isVirtualNic(name)) continue
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        list.push(entry.address)
      }
    }
  }
  return { primary: list[0] ?? 'N/A', list }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('system-info:get', (): SystemInfo => {
    const { primary, list } = collectIpv4()
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
      .map((d, idx) => ({
        id: d.id?.trim() || `dir-${Date.now()}-${idx}`,
        name: (d.name?.trim() || d.path).slice(0, 40),
        path: d.path.trim(),
      }))
    await writeStore({ directories: cleaned })
    return cleaned
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
