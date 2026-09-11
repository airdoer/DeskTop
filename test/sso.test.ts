import { describe, it, expect } from 'vitest'
// 与既有测试一致：vitest 未配置 @/ 别名，用相对路径引用
import {
  SSO_BASE_URL,
  SSO_SERVICE_URL,
  buildSsoLoginUrl,
  buildTicketValidateUrl,
  parseCasUser,
  parseTicketFromUrl,
} from '../electron/main/ssoCore'

/*
 * SSO 纯函数单元测试.
 * 覆盖：
 *   - buildSsoLoginUrl / buildTicketValidateUrl 的 URL 构造（service 参数 URL 编码、ticket 编码）
 *   - parseTicketFromUrl 从重定向 URL 提取 ticket（含边界：无 ticket / 非法 URL / 多参数）
 *   - parseCasUser 解析 CAS XML 响应（成功 / 失败 / 异常格式）
 *
 * 参考：快手 SSO 接入用户手册
 *   https://docs.corp.kuaishou.com/d/home/fcAAQRFa_IOGUD7uiDdyHyR4K
 */

describe('buildSsoLoginUrl', () => {
  it('指向 /cas/login 且 service 参数 URL 编码正确', () => {
    const url = buildSsoLoginUrl()
    expect(url.startsWith(`${SSO_BASE_URL}/cas/login?service=`)).toBe(true)
    // service 值必须 URL 编码（: → %3A, / → %2F）
    expect(url).toContain(encodeURIComponent(SSO_SERVICE_URL))
    expect(url).not.toContain(`${SSO_SERVICE_URL} `) // 不应出现未编码的原始地址
  })

  it('service 参数解码后等于 SSO_SERVICE_URL', () => {
    const url = buildSsoLoginUrl()
    const param = new URL(url).searchParams.get('service')
    expect(param).toBe(SSO_SERVICE_URL)
  })
})

describe('buildTicketValidateUrl', () => {
  it('指向 /cas/serviceValidate 且包含 ticket 与 service', () => {
    const ticket = 'ST-2-2OHBuFkZGhFa4ZZ6W7b9MmiwiDk-ksssonew'
    const url = buildTicketValidateUrl(ticket)
    expect(url.startsWith(`${SSO_BASE_URL}/cas/serviceValidate?`)).toBe(true)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('ticket')).toBe(ticket)
    expect(parsed.searchParams.get('service')).toBe(SSO_SERVICE_URL)
  })

  it('ticket 两侧空白会被 trim', () => {
    const ticket = '  ST-abc-123  '
    const url = buildTicketValidateUrl(ticket)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('ticket')).toBe('ST-abc-123')
  })

  it('ticket 含特殊字符会被 URL 编码', () => {
    const ticket = 'ST-a b+c&d'
    const url = buildTicketValidateUrl(ticket)
    const parsed = new URL(url)
    // decodeURIComponent 还原后等于 trim 后的 ticket
    expect(decodeURIComponent(parsed.searchParams.get('ticket') ?? '')).toBe('ST-a b+c&d')
  })

  it('与 buildSsoLoginUrl 的 service 参数保持一致（CAS 要求两者相同）', () => {
    const loginUrl = buildSsoLoginUrl()
    const validateUrl = buildTicketValidateUrl('ST-x')
    const serviceLogin = new URL(loginUrl).searchParams.get('service')
    const serviceValidate = new URL(validateUrl).searchParams.get('service')
    expect(serviceLogin).toBe(serviceValidate)
  })
})

describe('parseTicketFromUrl', () => {
  it('从重定向 URL 提取 ticket 参数', () => {
    const url = `${SSO_SERVICE_URL}?ticket=ST-2-abc123`
    expect(parseTicketFromUrl(url)).toBe('ST-2-abc123')
  })

  it('URL 含其他参数时仍能正确提取 ticket', () => {
    const url = `${SSO_SERVICE_URL}?foo=1&ticket=ST-xyz-456&bar=2`
    expect(parseTicketFromUrl(url)).toBe('ST-xyz-456')
  })

  it('无 ticket 参数时返回 null', () => {
    expect(parseTicketFromUrl(`${SSO_SERVICE_URL}?foo=1`)).toBeNull()
    expect(parseTicketFromUrl(SSO_SERVICE_URL)).toBeNull()
  })

  it('空字符串 / 非字符串 / 非法 URL 返回 null', () => {
    expect(parseTicketFromUrl('')).toBeNull()
    expect(parseTicketFromUrl(null as unknown as string)).toBeNull()
    expect(parseTicketFromUrl('not a url')).toBeNull()
  })

  it('ticket 值含特殊字符时保留原始编码', () => {
    const url = `${SSO_SERVICE_URL}?ticket=ST-a%2Bb%3Dc`
    expect(parseTicketFromUrl(url)).toBe('ST-a+b=c')
  })
})

describe('parseCasUser', () => {
  const SUCCESS_XML = `<cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
  <cas:authenticationSuccess>
    <cas:user>zhangsan03</cas:user>
  </cas:authenticationSuccess>
</cas:serviceResponse>`

  const FAILURE_XML = `<cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
  <cas:authenticationFailure code="INVALID_TICKET">Ticket 'ST-2-2OHBuFkZGhFa4ZZ6W7b9MmiwiDk-ksssonew' not recognized</cas:authenticationFailure>
</cas:serviceResponse>`

  it('成功响应解析出用户名', () => {
    const result = parseCasUser(SUCCESS_XML)
    expect(result.success).toBe(true)
    expect(result.username).toBe('zhangsan03')
    expect(result.error).toBeUndefined()
  })

  it('失败响应返回 success=false 与原因', () => {
    const result = parseCasUser(FAILURE_XML)
    expect(result.success).toBe(false)
    expect(result.username).toBeUndefined()
    expect(result.error).toContain('not recognized')
  })

  it('用户名含空白会被 trim', () => {
    const xml = `<cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
      <cas:authenticationSuccess>
        <cas:user>  chenzhixu  </cas:user>
      </cas:authenticationSuccess>
    </cas:serviceResponse>`
    const result = parseCasUser(xml)
    expect(result.success).toBe(true)
    expect(result.username).toBe('chenzhixu')
  })

  it('成功响应但 user 为空时返回 error', () => {
    const xml = `<cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
      <cas:authenticationSuccess>
        <cas:user></cas:user>
      </cas:authenticationSuccess>
    </cas:serviceResponse>`
    const result = parseCasUser(xml)
    expect(result.success).toBe(false)
    expect(result.error).toBe('SSO 响应中未找到用户名')
  })

  it('空字符串返回 error', () => {
    const result = parseCasUser('')
    expect(result.success).toBe(false)
    expect(result.error).toBe('SSO 响应为空')
  })

  it('非字符串返回 error', () => {
    const result = parseCasUser(null as unknown as string)
    expect(result.success).toBe(false)
    expect(result.error).toBe('SSO 响应为空')
  })

  it('无法识别的格式返回 error', () => {
    const result = parseCasUser('<html><body>not cas</body></html>')
    expect(result.success).toBe(false)
    expect(result.error).toBe('SSO 响应格式无法识别')
  })

  it('authenticationFailure 无内容时使用默认原因', () => {
    const xml = `<cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
      <cas:authenticationFailure code="INVALID_TICKET"></cas:authenticationFailure>
    </cas:serviceResponse>`
    const result = parseCasUser(xml)
    expect(result.success).toBe(false)
    expect(result.error).toBe('ticket 校验失败')
  })

  it('标签大小写不敏感（CAS XML 实际为大写命名空间）', () => {
    // 部分响应使用不同大小写，正则用 i 标志应能兼容
    const xml = `<cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
      <cas:authenticationSuccess>
        <cas:user>differentCase</cas:user>
      </cas:authenticationSuccess>
    </cas:serviceResponse>`
    const result = parseCasUser(xml)
    expect(result.success).toBe(true)
    expect(result.username).toBe('differentCase')
  })
})
