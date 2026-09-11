/*
 * SSO 登录 — Main Process 实现.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：Renderer 禁止直接访问外网，
 *   统一经 IPC Service 转发到 Main Process；SSO 凭证只存在于主进程。
 *
 * 参考：快手 SSO 接入用户手册（CAS 协议）
 *   https://docs.corp.kuaishou.com/d/home/fcAAQRFa_IOGUD7uiDdyHyR4K
 *
 * 客户端 APP 的 CAS 登录流程：
 *   1. 主进程创建子 BrowserWindow 加载 https://sso.corp.kuaishou.com/cas/login?service=<回调>
 *   2. 用户在子窗口中输入用户名/密码完成登录
 *   3. SSO 服务端 302 重定向到 service 回调地址，URL 携带 ?ticket=ST-xxx
 *   4. 主进程在 will-redirect 里拦截重定向（service 地址不存在，禁止浏览器加载），
 *      从 URL 提取 ticket，关闭登录窗口
 *   5. 主进程用 fetch 调用 /cas/serviceValidate 校验 ticket，解析 XML 拿 <cas:user> 用户名
 *   6. 用户名持久化到 userData/sso-session.json，通过 IPC 通知渲染层
 *
 * service 参数说明：
 *   SSO 要求 service 必须符合 *.corp.kuaishou.com 等规范域名。
 *   客户端 APP 没有后端，service 地址不需要真的存在，仅作为 CAS 回传 ticket 的载体，
 *   我们只从重定向 URL 里取 ticket，不真的让浏览器加载这个地址。
 *
 * 纯函数（URL 构造、XML 解析、ticket 提取）抽到 ./ssoCore.ts，便于单元测试覆盖。
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  SSO_BASE_URL,
  SSO_SERVICE_URL,
  buildSsoLoginUrl,
  buildTicketValidateUrl,
  parseCasUser,
  parseTicketFromUrl,
  type SsoSession,
  type SsoResult,
} from './ssoCore'

// 再导出纯函数与常量，保持 ipc.ts / 其他调用方从单一入口 import 的兼容性
export {
  SSO_BASE_URL,
  SSO_SERVICE_URL,
  buildSsoLoginUrl,
  buildTicketValidateUrl,
  parseCasUser,
  parseTicketFromUrl,
}
export type { SsoSession, SsoResult }

/** 登录态持久化文件名（与其它 store 同目录：userData/） */
const SESSION_FILE = 'sso-session.json'

/** ticket 校验请求超时（ticket 仅 10s 有效，超时不要太长） */
const SSO_VALIDATE_TIMEOUT_MS = 10000

function sessionPath(): string {
  return path.join(app.getPath('userData'), SESSION_FILE)
}

/** 读取本地 SSO session（启动时回显已登录用户用） */
export async function readSsoSession(): Promise<SsoSession | null> {
  try {
    const raw = await fs.readFile(sessionPath(), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    const username = typeof obj.username === 'string' ? obj.username.trim() : ''
    if (!username) return null
    const loginAt = typeof obj.loginAt === 'string' ? obj.loginAt : ''
    return { username, loginAt }
  } catch {
    return null
  }
}

/** 写入本地 SSO session */
export async function writeSsoSession(username: string): Promise<void> {
  const session: SsoSession = { username, loginAt: new Date().toISOString() }
  await fs.mkdir(path.dirname(sessionPath()), { recursive: true })
  await fs.writeFile(sessionPath(), JSON.stringify(session, null, 2), 'utf-8')
}

/** 清除本地 SSO session（登出） */
export async function clearSsoSession(): Promise<void> {
  try {
    await fs.unlink(sessionPath())
  } catch {
    /* 文件不存在视为已清除 */
  }
}

/**
 * 校验 ticket：调用 /cas/serviceValidate，解析 XML 拿用户名.
 * ticket 仅 10s 有效且只能用一次，失败原因由 parseCasUser 解析。
 */
export async function validateTicket(ticket: string): Promise<SsoResult> {
  const trimmed = (ticket ?? '').trim()
  if (!trimmed) return { success: false, error: 'ticket 为空' }

  const url = buildTicketValidateUrl(trimmed)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SSO_VALIDATE_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/xml, text/xml, */*' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return { success: false, error: `SSO 校验返回 ${response.status} ${response.statusText}` }
    }
    const xml = await response.text()
    return parseCasUser(xml)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const friendly = /abort/i.test(message)
      ? `SSO 校验超时（${SSO_VALIDATE_TIMEOUT_MS}ms）`
      : message
    return { success: false, error: friendly }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 启动 SSO 登录流程.
 * 1. 创建子 BrowserWindow 加载 SSO 登录页
 * 2. 监听 will-redirect / did-navigate，从 URL 提取 ticket
 * 3. 关闭登录窗口，用 ticket 校验拿用户名
 * 4. 成功后持久化 session
 *
 * @param parentWindow 父窗口，用于模态居中；为 null 时独立显示
 */
export async function startSsoLogin(parentWindow: BrowserWindow | null): Promise<SsoResult> {
  let loginWin: BrowserWindow | null = null
  let resolved = false

  return new Promise<SsoResult>((resolve) => {
    const finish = (result: SsoResult) => {
      if (resolved) return
      resolved = true
      const win = loginWin
      loginWin = null
      if (win && !win.isDestroyed()) {
        win.off('closed', onClosed)
        try {
          win.close()
        } catch {
          /* 窗口可能已销毁 */
        }
      }
      resolve(result)
    }

    const onClosed = () => {
      // 用户手动关闭登录窗口
      finish({ success: false, error: '登录已取消' })
    }

    const handleTicket = async (ticket: string) => {
      // 先隐藏窗口，避免用户看到 service 地址加载失败页
      if (loginWin && !loginWin.isDestroyed()) loginWin.hide()
      const result = await validateTicket(ticket)
      if (result.success && result.username) {
        await writeSsoSession(result.username)
      }
      finish(result)
    }

    const onWillRedirect = (event: Electron.Event, url: string) => {
      const ticket = parseTicketFromUrl(url)
      if (ticket) {
        // 阻止浏览器加载 service 回调地址（该地址不存在，加载会失败）
        event.preventDefault()
        void handleTicket(ticket)
      }
    }

    const onDidNavigate = (_event: Electron.Event, url: string) => {
      // 兜底：若 will-redirect 未触发（边界场景），导航完成后仍可从 URL 提取 ticket
      const ticket = parseTicketFromUrl(url)
      if (ticket) void handleTicket(ticket)
    }

    try {
      loginWin = new BrowserWindow({
        title: 'C7 DeskTop 登录',
        width: 480,
        height: 640,
        minWidth: 360,
        minHeight: 480,
        parent: parentWindow ?? undefined,
        modal: !!parentWindow,
        autoHideMenuBar: true,
        backgroundColor: '#fafafa',
        webPreferences: {
          // 登录窗口只加载 SSO 网页，不需要 preload / Node 集成，保持沙箱
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      })

      loginWin.on('closed', onClosed)
      loginWin.webContents.on('will-redirect', onWillRedirect)
      loginWin.webContents.on('did-navigate', onDidNavigate)

      void loginWin.loadURL(buildSsoLoginUrl())
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      finish({ success: false, error })
    }
  })
}
