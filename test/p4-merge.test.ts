import { describe, expect, it } from 'vitest'
// 与既有测试一致：vitest 未配置 @/ 别名，用相对路径引用
import {
  buildIntegrateArgs,
  buildPendingChangeDescription,
  buildResolveArgs,
  buildResolveOverrideArgs,
  buildSyncArgs,
  computeMergePreview,
  createInitialPipeline,
  dedupeCommonParentDirs,
  formatTimestamp,
  generateTransactionId,
  getExtension,
  mapSourceToTargetPath,
  MergeToolRegistry,
  normalizeDepotRoot,
  parseDescribeOutput,
  parseOpenedOutput,
  parseTaggedChanges,
  PIPELINE_STEP_ORDER,
  resolveMergeToolArgs,
} from '../electron/main/p4Merge'
import { buildRedmineIssueUrl, humanizeDate, parseRedmineRefs } from '../src/services/p4Merge'

/*
 * 样本取自 spec §10 与本机 p4 真实输出形态：
 *   p4 -ztag changes -c <client> -s submitted -m <n>  （parseTaggedChanges，字段名 desc / time）
 *   p4 describe -s <change>                          （parseDescribeOutput）
 *   p4 opened -c default                              （parseOpenedOutput）
 *
 * time 为 unix 秒；1789129232 对应 2026/09/11（本地时区），测试用 stringMatching 校验日期，
 *   避免不同时区下日期跨天导致断言失败.
 */

const P4_CHANGES_ZTAG = [
  '... change 2137156',
  '... time 1789129232',
  '... user chenzhixu',
  '... client chenzhixu_C7_Mainline',
  '... status submitted',
  '... changeType public',
  '... path //C7/Development/Mainline/Tools/ExcelToLuaTool/TestMerge/*',
  '... desc 测试merge功能 #361226 【On',
  '',
  '... change 2134696',
  '... time 1789108035',
  '... user chenzhixu',
  '... client chenzhixu_C7_Mainline',
  '... status submitted',
  '... desc 压测commonredistag配置添加',
  '',
].join('\n')

const P4_DESCRIBE_OUTPUT = [
  'Change 2132162 by chenzhixu@chenzhixu_C7_Mainline on 2026/09/11 18:00:00',
  '',
  '\t增加ksbc table级别的lua化',
  '',
  'Affected files ...',
  '',
  '... //C7/Development/Mainline/Client/Content/Script/Framework/Utils/LuaCommon/Managers/TableDataManager.lua#1 edit',
  '... //C7/Development/Mainline/Client/Config/B.xlsx#1 add',
  '... //C7/Development/Mainline/Client/Config/C.json#2 edit',
  '',
  'Differences ...',
  '',
].join('\n')

const P4_OPENED_OUTPUT = [
  '//C7/Development/Weekly/Client/Config/C.json#2 edit default (text) by chenzhixu@chenzhixu_C7_Weekly',
  '//C7/Development/Weekly/Client/A.lua#3 add 2150001 (text) by chenzhixu@chenzhixu_C7_Weekly',
].join('\n')

describe('normalizeDepotRoot', () => {
  it('去掉尾部 / 与 /...', () => {
    expect(normalizeDepotRoot('//C7/Development/Mainline')).toBe('//C7/Development/Mainline')
    expect(normalizeDepotRoot('//C7/Development/Mainline/')).toBe('//C7/Development/Mainline')
    expect(normalizeDepotRoot('//C7/Development/Mainline/...')).toBe('//C7/Development/Mainline')
  })
  it('空白会被 trim', () => {
    expect(normalizeDepotRoot('  //C7/Development/Mainline  ')).toBe('//C7/Development/Mainline')
  })
})

describe('mapSourceToTargetPath', () => {
  const mapping = { source: '//C7/Development/Mainline', target: '//C7/Development/Weekly' }

  it('严格按根前缀替换', () => {
    expect(mapSourceToTargetPath('//C7/Development/Mainline/Client/A.lua', mapping)).toBe(
      '//C7/Development/Weekly/Client/A.lua',
    )
  })
  it('源路径不属于该分支根时返回 null', () => {
    expect(mapSourceToTargetPath('//Other/Depot/A.lua', mapping)).toBeNull()
  })
  it('mapping 带尾部 /... 也能正确归一', () => {
    const m2 = { source: '//C7/Development/Mainline/...', target: '//C7/Development/Weekly/...' }
    expect(mapSourceToTargetPath('//C7/Development/Mainline/Client/A.lua', m2)).toBe(
      '//C7/Development/Weekly/Client/A.lua',
    )
  })
})

describe('getExtension', () => {
  it('从 depot 路径取小写扩展名', () => {
    expect(getExtension('//C7/Dev/Client/A.lua')).toBe('.lua')
    expect(getExtension('//C7/Dev/Client/Config.B.XLSX')).toBe('.xlsx')
  })
  it('无扩展名返回空字符串', () => {
    expect(getExtension('//C7/Dev/Client/NoExt')).toBe('')
  })
})

describe('MergeToolRegistry', () => {
  const registry = new MergeToolRegistry([
    {
      id: 'p4merge',
      name: 'P4Merge',
      executable: '',
      extensions: ['.lua', '.json', '.txt'],
      arguments: '%b %1 %2 %r',
      priority: 10,
    },
    {
      id: 'key-excel-merge',
      name: 'KeyExcelMerge',
      executable: 'KeyExcelMerge.exe',
      extensions: ['.xlsx', '.xlsm'],
      arguments: '%b %1 %2 %r VCSTool=p4',
      priority: 5,
    },
  ])

  it('按扩展名匹配工具', () => {
    expect(registry.resolve('.lua')?.id).toBe('p4merge')
    expect(registry.resolve('.xlsx')?.id).toBe('key-excel-merge')
  })
  it('多个匹配按 priority 升序（数字小优先）', () => {
    const r = new MergeToolRegistry([
      { id: 'a', name: 'A', executable: '', extensions: ['.lua'], arguments: '', priority: 20 },
      { id: 'b', name: 'B', executable: '', extensions: ['.lua'], arguments: '', priority: 5 },
    ])
    expect(r.resolve('.lua')?.id).toBe('b')
  })
  it('二进制扩展名返回 null（Manual）', () => {
    expect(registry.resolve('.uasset')).toBeNull()
  })
  it('未注册 p4merge 且非二进制时回退 null', () => {
    const r = new MergeToolRegistry([
      { id: 'key-excel-merge', name: 'K', executable: '', extensions: ['.xlsx'], arguments: '', priority: 5 },
    ])
    expect(r.resolve('.lua')).toBeNull()
  })
})

describe('resolveMergeToolArgs', () => {
  it('把 %b %1 %2 %r 替换为 context 字段', () => {
    const args = resolveMergeToolArgs('%b %1 %2 %r', {
      baseFile: '/tmp/base',
      sourceFile: '/tmp/src',
      targetFile: '/tmp/tgt',
      resultFile: '/tmp/res',
      sourceDepotPath: '',
      targetDepotPath: '',
    })
    expect(args).toEqual(['/tmp/base', '/tmp/src', '/tmp/tgt', '/tmp/res'])
  })
  it('保留非变量 token（如 VCSTool=p4）', () => {
    const args = resolveMergeToolArgs('%b %1 %2 %r VCSTool=p4', {
      baseFile: '/b',
      sourceFile: '/1',
      targetFile: '/2',
      resultFile: '/r',
      sourceDepotPath: '',
      targetDepotPath: '',
    })
    expect(args).toEqual(['/b', '/1', '/2', '/r', 'VCSTool=p4'])
  })
})

describe('parseTaggedChanges', () => {
  it('按 ... change 切分记录，识别 desc / time / user / client / status 字段', () => {
    const records = parseTaggedChanges(P4_CHANGES_ZTAG)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      change: 2137156,
      user: 'chenzhixu',
      client: 'chenzhixu_C7_Mainline',
      status: 'submitted',
      description: '测试merge功能 #361226 【On',
    })
    // time 1789129232 → 2026/09/11（本地时区），日期格式 YYYY/MM/DD HH:MM:SS
    expect(records[0].date).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(records[1].change).toBe(2134696)
    expect(records[1].description).toBe('压测commonredistag配置添加')
  })
  it('忽略 ztag 中未识别的字段（changeType / path / oldChange 等）', () => {
    const records = parseTaggedChanges('... change 1\n... changeType public\n... path //x/*\n... user u\n')
    expect(records).toHaveLength(1)
    expect(records[0].user).toBe('u')
  })
  it('空输入返回空数组', () => {
    expect(parseTaggedChanges('')).toEqual([])
  })
})

describe('formatTimestamp', () => {
  it('把 unix 秒格式化为 YYYY/MM/DD HH:MM:SS', () => {
    // 1789129232 → 2026-09-11 20:14:02（UTC+8）/ 12:14:02（UTC），都含 2026/09/11
    expect(formatTimestamp(1789129232)).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe('parseDescribeOutput', () => {
  it('提取 change / description / files（含 action 与 revision）', () => {
    const parsed = parseDescribeOutput(P4_DESCRIBE_OUTPUT)
    expect(parsed.change).toBe(2132162)
    expect(parsed.description).toBe('增加ksbc table级别的lua化')
    expect(parsed.files).toHaveLength(3)
    expect(parsed.files[0]).toMatchObject({
      depotPath: '//C7/Development/Mainline/Client/Content/Script/Framework/Utils/LuaCommon/Managers/TableDataManager.lua',
      revision: 1,
      action: 'edit',
    })
    expect(parsed.files[1].action).toBe('add')
    expect(parsed.files[2].revision).toBe(2)
  })
})

describe('parseOpenedOutput', () => {
  it('解析 depot / revision / action / change / type / client', () => {
    const opened = parseOpenedOutput(P4_OPENED_OUTPUT)
    expect(opened).toHaveLength(2)
    expect(opened[0]).toMatchObject({
      depotPath: '//C7/Development/Weekly/Client/Config/C.json',
      revision: '2',
      action: 'edit',
      change: 'default',
      fileType: 'text',
      client: 'chenzhixu_C7_Weekly',
    })
    expect(opened[1].change).toBe('2150001')
  })
  it('忽略非 // 开头的行', () => {
    expect(parseOpenedOutput('no open files\n\n//depot/x#1 edit default')).toHaveLength(1)
  })
})

describe('computeMergePreview', () => {
  const mapping = { source: '//C7/Development/Mainline', target: '//C7/Development/Weekly' }
  const registry = new MergeToolRegistry([
    { id: 'p4merge', name: 'P4Merge', executable: '', extensions: ['.lua', '.json'], arguments: '%b %1 %2 %r', priority: 10 },
    { id: 'key-excel-merge', name: 'KeyExcelMerge', executable: '', extensions: ['.xlsx'], arguments: '%b %1 %2 %r', priority: 5 },
  ])
  const changeFiles = [
    { depotPath: '//C7/Development/Mainline/Client/A.lua', revision: 1, action: 'edit' as const },
    { depotPath: '//C7/Development/Mainline/Client/B.xlsx', revision: 1, action: 'add' as const },
    { depotPath: '//C7/Development/Mainline/Client/C.json', revision: 2, action: 'edit' as const },
    { depotPath: '//C7/Development/Mainline/Client/D.uasset', revision: 1, action: 'add' as const },
  ]

  it('逐文件映射目标路径 + 命中工具 + 预测状态（二进制走覆盖策略）', () => {
    const preview = computeMergePreview({
      sourceWorkspace: 'chenzhixu_C7_Mainline',
      targetWorkspace: 'chenzhixu_C7_Weekly',
      sourceChange: 2132162,
      mapping,
      changeFiles,
      registry,
    })
    expect(preview.files).toHaveLength(4)
    expect(preview.files[0]).toMatchObject({
      sourcePath: '//C7/Development/Mainline/Client/A.lua',
      targetPath: '//C7/Development/Weekly/Client/A.lua',
      mergeTool: 'p4merge',
      mergeToolName: 'P4Merge',
      status: 'pending',
    })
    expect(preview.files[1].mergeTool).toBe('key-excel-merge')
    // 二进制文件走覆盖策略（accept source），而非「不支持」
    expect(preview.files[3]).toMatchObject({
      mergeTool: 'binary-override',
      mergeToolName: '覆盖(Accept Source)',
      status: 'override',
    })
    expect(preview.autoCount).toBe(3)
    expect(preview.overrideCount).toBe(1)
    expect(preview.unsupportedCount).toBe(0)
    expect(preview.manualCount).toBe(0)
  })

  it('源路径无法映射时计入 warnings 并跳过该文件', () => {
    const preview = computeMergePreview({
      sourceWorkspace: 'a',
      targetWorkspace: 'b',
      sourceChange: 1,
      mapping,
      changeFiles: [{ depotPath: '//Other/Depot/X.lua', revision: 1, action: 'edit' }],
      registry,
    })
    expect(preview.files).toHaveLength(0)
    expect(preview.warnings).toHaveLength(1)
    expect(preview.warnings[0]).toContain('//Other/Depot/X.lua')
  })
})

describe('buildIntegrateArgs', () => {
  it('构造 p4 -c <client> integrate -c <targetChange> <source>#<rev> <target>', () => {
    const args = buildIntegrateArgs({
      targetClient: 'chenzhixu_C7_Weekly',
      targetChange: '2150001',
      files: [
        { sourcePath: '//C7/Development/Mainline/Client/A.lua', targetPath: '//C7/Development/Weekly/Client/A.lua', sourceRevision: 1 },
      ],
    })
    expect(args).toEqual([
      '-c', 'chenzhixu_C7_Weekly',
      'integrate', '-c', '2150001',
      '//C7/Development/Mainline/Client/A.lua#1', '//C7/Development/Weekly/Client/A.lua',
    ])
  })
})

describe('buildResolveArgs', () => {
  it('auto 模式带 -am', () => {
    const args = buildResolveArgs({ targetClient: 'c_weekly', mode: 'auto' })
    expect(args).toEqual(['-c', 'c_weekly', 'resolve', '-am'])
  })
  it('preview 模式带 -n（不修改，只预览冲突）', () => {
    const args = buildResolveArgs({ targetClient: 'c_weekly', mode: 'preview' })
    expect(args).toEqual(['-c', 'c_weekly', 'resolve', '-n'])
  })
  it('传入 files 时追加到末尾', () => {
    const args = buildResolveArgs({ targetClient: 'c_weekly', mode: 'auto', files: ['//depot/a', '//depot/b'] })
    expect(args.slice(-2)).toEqual(['//depot/a', '//depot/b'])
  })
})

describe('buildResolveOverrideArgs', () => {
  it('构造 p4 resolve -as（accept source，二进制覆盖）', () => {
    const args = buildResolveOverrideArgs({ targetClient: 'c_weekly' })
    expect(args).toEqual(['-c', 'c_weekly', 'resolve', '-as'])
  })
  it('传入二进制文件列表时追加到末尾', () => {
    const args = buildResolveOverrideArgs({
      targetClient: 'c_weekly',
      files: ['//C7/Weekly/Client/D.uasset'],
    })
    expect(args).toEqual(['-c', 'c_weekly', 'resolve', '-as', '//C7/Weekly/Client/D.uasset'])
  })
})

describe('buildSyncArgs', () => {
  it('File 模式只 sync 指定文件（默认）', () => {
    const args = buildSyncArgs({ targetClient: 'c_weekly', files: ['//C7/Weekly/a', '//C7/Weekly/b'] })
    expect(args).toEqual(['-c', 'c_weekly', 'sync', '//C7/Weekly/a', '//C7/Weekly/b'])
  })
  it('显式 File 模式与默认等价', () => {
    const args = buildSyncArgs({ targetClient: 'c_weekly', files: ['//C7/Weekly/a'], mode: 'file' })
    expect(args).toEqual(['-c', 'c_weekly', 'sync', '//C7/Weekly/a'])
  })
  it('Directory 模式 sync 共同父目录 /...', () => {
    const args = buildSyncArgs({
      targetClient: 'c_weekly',
      files: [
        '//C7/Weekly/Client/A.lua',
        '//C7/Weekly/Client/B.xlsx',
        '//C7/Weekly/Server/C.json',
      ],
      mode: 'directory',
    })
    expect(args).toEqual([
      '-c', 'c_weekly', 'sync',
      '//C7/Weekly/Client/...',
      '//C7/Weekly/Server/...',
    ])
  })
})

describe('dedupeCommonParentDirs', () => {
  it('同一目录的多个文件合并为该目录', () => {
    expect(
      dedupeCommonParentDirs(['//C7/Weekly/Client/A.lua', '//C7/Weekly/Client/B.xlsx']),
    ).toEqual(['//C7/Weekly/Client'])
  })
  it('不同目录各自保留父目录', () => {
    expect(
      dedupeCommonParentDirs(['//C7/Weekly/Client/A.lua', '//C7/Weekly/Server/B.json']),
    ).toEqual(['//C7/Weekly/Client', '//C7/Weekly/Server'])
  })
  it('无 / 的路径原样返回', () => {
    expect(dedupeCommonParentDirs(['nofiles'])).toEqual(['nofiles'])
  })
})

describe('buildPendingChangeDescription', () => {
  it('按 spec §18 模板生成 Pending CL 描述', () => {
    const desc = buildPendingChangeDescription({
      sourceBranch: '//C7/Development/Mainline',
      sourceChange: 2132162,
      targetBranch: '//C7/Development/Weekly',
      user: 'chenzhixu',
      sourceDescription: '增加ksbc table级别的lua化',
    })
    expect(desc).toContain('[Cross Branch Merge]')
    expect(desc).toContain('Source: //C7/Development/Mainline')
    expect(desc).toContain('Source Change: 2132162')
    expect(desc).toContain('Target: //C7/Development/Weekly')
    expect(desc).toContain('User: chenzhixu')
    expect(desc).toContain('Original Description:')
    expect(desc).toContain('增加ksbc table级别的lua化')
  })
})

describe('Pipeline 状态模型', () => {
  it('createInitialPipeline 按 PIPELINE_STEP_ORDER 生成 6 个 idle 步骤', () => {
    const pipeline = createInitialPipeline()
    expect(pipeline).toHaveLength(6)
    expect(pipeline.map((s) => s.id)).toEqual(PIPELINE_STEP_ORDER)
    expect(pipeline.every((s) => s.status === 'idle')).toBe(true)
    expect(pipeline.every((s) => s.logs.length === 0)).toBe(true)
  })
})

describe('generateTransactionId', () => {
  it('格式为 MERGE-YYYYMMDD-NNNNN', () => {
    const id = generateTransactionId(new Date(2026, 8, 11, 18, 0, 0))
    expect(id).toMatch(/^MERGE-20260911-\d{5}$/)
  })
})

/*
 * Redmine 单号解析 + human 相对时间（渲染层 service）.
 * parseRedmineRefs / buildRedmineIssueUrl / humanizeDate 在 src/services/p4Merge.ts.
 */

describe('parseRedmineRefs', () => {
  it('从描述中提取 #数字 形式的 Redmine 单号（4-7 位）', () => {
    const refs = parseRedmineRefs('测试merge功能 #361226 【Online】')
    expect(refs).toEqual([{ match: '#361226', id: '361226' }])
  })
  it('支持多个单号', () => {
    const refs = parseRedmineRefs('修复 #361226 和 #361300 的问题')
    expect(refs.map((r) => r.id)).toEqual(['361226', '361300'])
  })
  it('忽略 #fix 这类非单号（数字不足 4 位）', () => {
    expect(parseRedmineRefs('#fix #12 通用')).toEqual([])
  })
  it('无单号返回空数组', () => {
    expect(parseRedmineRefs('没有单号的描述')).toEqual([])
  })
})

describe('buildRedmineIssueUrl', () => {
  it('用 Redmine issue 页模板拼 URL', () => {
    expect(buildRedmineIssueUrl('361226')).toBe(
      'https://gamecloud-redmine.corp.kuaishou.com/1007/projects/c7/issues/361226',
    )
  })
  it('支持数字 id', () => {
    expect(buildRedmineIssueUrl(361226)).toContain('/issues/361226')
  })
})

describe('humanizeDate', () => {
  // 固定 now 为 2026/09/11 20:20:32 之后某时刻，便于断言相对时间
  const now = new Date(2026, 8, 11, 20, 30, 0) // 2026-09-11 20:30:00
  it('几分钟前', () => {
    // 20:20:32 → 距 20:30:00 约 9 分 28 秒
    expect(humanizeDate('2026/09/11 20:20:32', now)).toBe('9 分钟前')
  })
  it('几小时前', () => {
    expect(humanizeDate('2026/09/11 18:00:00', now)).toBe('2 小时前')
  })
  it('一天前', () => {
    expect(humanizeDate('2026/09/10 20:30:00', now)).toBe('一天前')
  })
  it('N 天前（≤ 4 天）', () => {
    expect(humanizeDate('2026/09/08 10:00:00', now)).toBe('3 天前')
  })
  it('超过 4 天返回空（不显示标签）', () => {
    expect(humanizeDate('2026/09/01 10:00:00', now)).toBe('')
    expect(humanizeDate('2025/12/31 10:00:00', now)).toBe('')
  })
  it('非法输入返回空', () => {
    expect(humanizeDate('not a date')).toBe('')
    expect(humanizeDate('')).toBe('')
  })
})
