/*
 * SSO 纯函数模块 — 不依赖 Electron/Node 的纯逻辑.
 * 与 sso.ts 分离：sso.ts 负责 IO（读写 session 文件、网络校验、创建登录窗口），
 *   本模块只放 URL 构造、XML 解析、ticket 提取等纯函数，便于单元测试覆盖。
 *
 * 参考：快手 SSO 接入用户手册（CAS 协议）
 *   https://docs.corp.kuaishou.com/d/home/fcAAQRFa_IOGUD7uiDdyHyR4K
 */

/** SSO 服务器基址 */
export const SSO_BASE_URL = 'https://sso.corp.kuaishou.com'

/**
 * CAS 回调 service 地址.
 * 必须符合 *.corp.kuaishou.com 规范域名白名单；此地址不需要真的存在，
 * 主进程会在 will-redirect 阶段拦截，浏览器不会真的加载它。
 */
export const SSO_SERVICE_URL = 'https://desktop.corp.kuaishou.com/cas/callback'

export interface SsoSession {
  /** SSO 返回的用户名（邮箱前缀，如 chenzhixu） */
  username: string
  /** 登录时间（ISO 字符串，回显用） */
  loginAt: string
}

export interface SsoResult {
  success: boolean
  username?: string
  error?: string
}

/**
 * 构造 SSO 登录 URL（含 service 参数 URL 编码）.
 * 纯函数：不访问网络，便于单元测试覆盖。
 */
export function buildSsoLoginUrl(): string {
  const service = encodeURIComponent(SSO_SERVICE_URL)
  return `${SSO_BASE_URL}/cas/login?service=${service}`
}

/**
 * 构造 ticket 校验 URL.
 * service 必须与 /cas/login 中 service 参数一致，否则校验失败（INVALID_TICKET）。
 * 纯函数：不访问网络，便于单元测试覆盖。
 */
export function buildTicketValidateUrl(ticket: string): string {
  const service = encodeURIComponent(SSO_SERVICE_URL)
  const ticketParam = encodeURIComponent(ticket.trim())
  return `${SSO_BASE_URL}/cas/serviceValidate?ticket=${ticketParam}&service=${service}`
}

/**
 * 从重定向 URL 中提取 ticket 参数.
 * 不限定域名：只要 URL 的 query 里包含 ticket 即返回其值，便于测试与边界场景兜底。
 * 纯函数：不访问网络，便于单元测试覆盖。
 */
export function parseTicketFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('ticket')
  } catch {
    return null
  }
}

/**
 * 从 CAS serviceValidate XML 响应中解析用户名.
 * 成功响应：
 *   <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
 *     <cas:authenticationSuccess>
 *       <cas:user>zhangsan03</cas:user>
 *     </cas:authenticationSuccess>
 *   </cas:serviceResponse>
 * 失败响应：
 *   <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
 *     <cas:authenticationFailure code="INVALID_TICKET">Ticket '...' not recognized</cas:authenticationFailure>
 *   </cas:serviceResponse>
 * 纯函数：不访问网络，便于单元测试覆盖。
 */
export function parseCasUser(xml: string): SsoResult {
  if (!xml || typeof xml !== 'string') {
    return { success: false, error: 'SSO 响应为空' }
  }
  // 优先匹配成功响应：<cas:authenticationSuccess>...<cas:user>NAME</cas:user>...</cas:authenticationSuccess>
  // 用 [^<]* 而非 [^<]+ 允许 <cas:user></cas:user> 空标签匹配，再在下面判断 username 非空
  const successMatch = xml.match(
    /<cas:authenticationSuccess>[\s\S]*?<cas:user>([^<]*)<\/cas:user>/i,
  )
  if (successMatch) {
    const username = successMatch[1].trim()
    if (username) return { success: true, username }
    return { success: false, error: 'SSO 响应中未找到用户名' }
  }
  // 失败响应：<cas:authenticationFailure code="...">reason</cas:authenticationFailure>
  const failureMatch = xml.match(/<cas:authenticationFailure[^>]*>([^<]*)<\/cas:authenticationFailure>/i)
  if (failureMatch) {
    const reason = failureMatch[1].trim() || 'ticket 校验失败'
    return { success: false, error: reason }
  }
  return { success: false, error: 'SSO 响应格式无法识别' }
}
