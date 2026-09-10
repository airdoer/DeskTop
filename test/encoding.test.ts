import { describe, expect, it } from 'vitest'
// 与既有测试一致：vitest 未配置 @/ 别名，用相对路径引用
import {
  EXPECTED_CODE_PAGE,
  FIX_SCRIPT_RELATIVE_PATH,
  MAINLINE_STREAM,
  evaluateEncoding,
  findMainlineWorkspace,
  fixScriptPath,
  isUtf8Charset,
  isUtf8CodePage,
  normalizeP4Charset,
  parseRegQueryOutput,
  type CodePageValues,
} from '../electron/main/encoding'
import type { P4ClientRecord } from '../electron/main/p4'

/*
 * 覆盖「设置编码格式（需要以管理员运行）.bat」改写的东西：
 *   1. 注册表 HKLM\...\Nls\CodePage 的 ACP / OEMCP / MACCP 是否已是 65001
 *   2. P4CHARSET 是否已是 utf8
 * 以及修复脚本的定位逻辑（Mainline 工作区 → Design\设置编码格式（需要以管理员运行）.bat）。
 */

const REG_OUTPUT_UTF8 = [
  '',
  'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage',
  '    ACP    REG_SZ    65001',
  '    OEMCP    REG_SZ    65001',
  '    MACCP    REG_SZ    65001',
  '',
].join('\r\n')

const REG_OUTPUT_GBK = [
  'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage',
  '    ACP    REG_SZ    936',
  '    OEMCP    REG_SZ    936',
  '    MACCP    REG_SZ    10008',
  '',
].join('\r\n')

const CLIENTS: P4ClientRecord[] = [
  { client: 'chenzhixu_C7_Design', root: 'E:\\Project\\C7_Design', stream: '//C7/Development/Design' },
  { client: 'chenzhixu_C7_Mainline', root: 'E:\\Project\\C7_project', stream: '//C7/Development/Mainline' },
  { client: 'chenzhixu_C7_Online', root: 'E:\\Project\\C7_Online', stream: '//C7/Release/Online' },
  { client: 'swarm-temp', root: '/home/perforce/swarm' },
]

describe('parseRegQueryOutput', () => {
  it('解析 UTF-8 代码页', () => {
    expect(parseRegQueryOutput(REG_OUTPUT_UTF8)).toEqual({
      acp: '65001',
      oemcp: '65001',
      maccp: '65001',
    })
  })

  it('解析非 UTF-8 代码页', () => {
    expect(parseRegQueryOutput(REG_OUTPUT_GBK)).toEqual({
      acp: '936',
      oemcp: '936',
      maccp: '10008',
    })
  })

  it('键不存在或查询报错时返回空对象', () => {
    expect(parseRegQueryOutput('错误: 系统找不到指定的注册表项或值。')).toEqual({})
    expect(parseRegQueryOutput('')).toEqual({})
  })
})

describe('isUtf8CodePage / isUtf8Charset / normalizeP4Charset', () => {
  it('仅 65001 视为 UTF-8 代码页', () => {
    expect(isUtf8CodePage(EXPECTED_CODE_PAGE)).toBe(true)
    expect(isUtf8CodePage('936')).toBe(false)
    expect(isUtf8CodePage(undefined)).toBe(false)
  })

  it('utf8 与 utf-8 都算 P4CHARSET 正确，大小写不敏感', () => {
    expect(isUtf8Charset('utf8')).toBe(true)
    expect(isUtf8Charset('UTF-8')).toBe(true)
    expect(isUtf8Charset('winansi')).toBe(false)
  })

  it('空值与占位文本归一化为未设置', () => {
    expect(normalizeP4Charset(undefined)).toBeUndefined()
    expect(normalizeP4Charset('  ')).toBeUndefined()
    expect(normalizeP4Charset('unset')).toBeUndefined()
    expect(normalizeP4Charset(' utf8 ')).toBe('utf8')
  })
})

describe('evaluateEncoding', () => {
  const utf8Pages: CodePageValues = { acp: '65001', oemcp: '65001', maccp: '65001' }

  it('代码页与 P4CHARSET 都正确 → 编码正确', () => {
    const result = evaluateEncoding(utf8Pages, { checked: true, charset: 'utf8' })
    expect(result).toMatchObject({ ok: true, acpOk: true, charsetOk: true, p4Charset: 'utf8' })
  })

  it('代码页正确但 P4CHARSET 未设置 → 编码异常', () => {
    const result = evaluateEncoding(utf8Pages, { checked: true })
    expect(result).toMatchObject({ ok: false, acpOk: true, charsetOk: false })
  })

  it('系统代码页仍是 936 → 编码异常（P4CHARSET 正确也不影响结论）', () => {
    const result = evaluateEncoding({ acp: '936' }, { checked: true, charset: 'utf8' })
    expect(result).toMatchObject({ ok: false, acpOk: false, charsetOk: true })
  })

  it('p4 不可用时只按代码页判定，并给出说明', () => {
    const result = evaluateEncoding(utf8Pages)
    expect(result).toMatchObject({ ok: true, acpOk: true, charsetOk: undefined })
    expect(result.note).toContain('p4')
  })

  it('注册表没有 ACP 值 → 视为未设置，判定异常', () => {
    const result = evaluateEncoding({}, { checked: true, charset: 'utf8' })
    expect(result).toMatchObject({ ok: false, acpOk: false, acp: undefined })
  })
})

describe('findMainlineWorkspace', () => {
  it('定位 stream 为 //C7/Development/Mainline 的工作区', () => {
    expect(findMainlineWorkspace(CLIENTS)?.client).toBe('chenzhixu_C7_Mainline')
  })

  it('兼容大小写与尾斜杠', () => {
    const records: P4ClientRecord[] = [
      { client: 'c', root: 'E:\\p', stream: '//c7/development/mainline/' },
    ]
    expect(findMainlineWorkspace(records)?.client).toBe('c')
  })

  it('没有 Mainline 工作区时返回 null', () => {
    expect(findMainlineWorkspace([CLIENTS[0], CLIENTS[2], CLIENTS[3]])).toBeNull()
    expect(findMainlineWorkspace([])).toBeNull()
  })
})

describe('fixScriptPath', () => {
  it('拼接出工作区内的脚本绝对路径', () => {
    expect(fixScriptPath('E:\\Project\\C7_project')).toBe(
      `E:\\Project\\C7_project\\${FIX_SCRIPT_RELATIVE_PATH.replace(/\//g, '\\')}`,
    )
  })

  it('常量指向 Mainline stream', () => {
    expect(MAINLINE_STREAM).toBe('//C7/Development/Mainline')
  })
})
