import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONFIG_FILES,
  readAppConfigInfo,
  resetAppConfig,
} from '../electron/main/appConfig'

/*
 * 本地配置目录：扫描 + 一键重置.
 *
 * 这组测试守的是「删哪些、不删哪些」——重置是本项目唯一的破坏性操作，
 *   删错一个文件就是用户数据丢失，删漏一个就是「重置了但没生效」。
 *   故重点不在格式化，而在清单边界与幂等性。
 */

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-appconfig-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const writeFile = (name: string, content: string) =>
  fs.writeFile(path.join(dir, name), content, 'utf-8')

describe('CONFIG_FILES 清单', () => {
  it('文件名唯一、label 非空', () => {
    const names = CONFIG_FILES.map((f) => f.file)
    expect(new Set(names).size).toBe(names.length)
    for (const entry of CONFIG_FILES) {
      expect(entry.label.trim().length).toBeGreaterThan(0)
    }
  })

  /*
   * 回归点：sso-session.json 是登录会话，不是用户偏好。
   * 一旦被纳入重置清单，「一键重置」会把用户踢出登录 —— 这是明确设计排除项，
   * 用测试锁住，避免后来者「顺手补齐清单」时破坏它。
   */
  it('不包含 sso-session.json（重置不应导致登出）', () => {
    expect(CONFIG_FILES.some((f) => f.file === 'sso-session.json')).toBe(false)
  })
})

describe('readAppConfigInfo', () => {
  it('目录不存在时自动创建，并列出全部配置项为未创建', async () => {
    const target = path.join(dir, 'nested', 'userData')
    const info = await readAppConfigInfo(target)

    expect(info.directory).toBe(target)
    expect(info.existing).toBe(0)
    expect(info.files).toHaveLength(CONFIG_FILES.length)
    expect(info.files.every((f) => f.exists === false && f.size === 0)).toBe(true)
    // 「打开配置目录」依赖目录真实存在
    await expect(fs.stat(target)).resolves.toBeTruthy()
  })

  it('报告已落盘文件的存在状态与字节数', async () => {
    await writeFile('quick-directories.json', '{"directories":[]}')
    await writeFile('frequent-websites.json', 'x'.repeat(2048))

    const info = await readAppConfigInfo(dir)
    const byName = new Map(info.files.map((f) => [f.file, f]))

    expect(info.existing).toBe(2)
    expect(byName.get('quick-directories.json')?.exists).toBe(true)
    expect(byName.get('quick-directories.json')?.size).toBe('{"directories":[]}'.length)
    expect(byName.get('frequent-websites.json')?.size).toBe(2048)
    expect(byName.get('ui-preferences.json')?.exists).toBe(false)
  })

  it('label 与文件名成对返回，UI 无需自行维护映射', async () => {
    const info = await readAppConfigInfo(dir)
    for (const entry of info.files) {
      const spec = CONFIG_FILES.find((f) => f.file === entry.file)
      expect(entry.label).toBe(spec?.label)
    }
  })
})

describe('resetAppConfig', () => {
  it('删除清单内的全部文件并返回最新状态', async () => {
    for (const { file } of CONFIG_FILES) await writeFile(file, '{}')

    const result = await resetAppConfig(dir)

    expect(result.removed).toBe(CONFIG_FILES.length)
    expect(result.info.existing).toBe(0)
    expect(result.info.files.every((f) => !f.exists)).toBe(true)
    // 返回的 info 已重新扫描，UI 不需要再发一次请求
    for (const { file } of CONFIG_FILES) {
      await expect(fs.stat(path.join(dir, file))).rejects.toThrow()
    }
  })

  it('removed 只统计原本存在的文件（幂等：再重置一次得 0）', async () => {
    await writeFile('quick-directories.json', '{}')
    await writeFile('p4-favorites.json', '{"names":[]}')

    expect((await resetAppConfig(dir)).removed).toBe(2)
    expect((await resetAppConfig(dir)).removed).toBe(0)
  })

  it('只删清单内的文件，其余数据（如登录会话）保留', async () => {
    await writeFile('quick-directories.json', '{}')
    await writeFile('sso-session.json', '{"user":"chenzhixu"}')
    await writeFile('unrelated.log', 'keep me')

    await resetAppConfig(dir)

    await expect(fs.readFile(path.join(dir, 'sso-session.json'), 'utf-8')).resolves.toContain(
      'chenzhixu',
    )
    await expect(fs.readFile(path.join(dir, 'unrelated.log'), 'utf-8')).resolves.toBe('keep me')
  })

  it('目录不存在时不抛错（全新安装也能安全调用）', async () => {
    const target = path.join(dir, 'missing', 'userData')
    const result = await resetAppConfig(target)

    expect(result.removed).toBe(0)
    expect(result.info.existing).toBe(0)
  })

  it('不存在的文件不会被计入 removed（force 吞掉 ENOENT 但不虚报）', async () => {
    await writeFile('ui-preferences.json', '{}')
    const result = await resetAppConfig(dir)
    expect(result.removed).toBe(1)
  })
})
