import { describe, expect, it } from 'vitest'
// 与既有测试一致：vitest 未配置 @/ 别名，用相对路径引用
import {
  buildExcelMergeArgs,
  buildIntegrateArgs,
  buildOpenedArgs,
  buildPendingChangeDescription,
  buildP4PrintArgs,
  buildP4WhereArgs,
  buildResolveAcceptYoursArgs,
  buildResolveArgs,
  buildResolveOverrideArgs,
  buildRevertArgs,
  buildSyncArgs,
  computeMergePreview,
  createInitialPipeline,
  dedupeCommonParentDirs,
  EXCEL_EXTENSIONS,
  formatTimestamp,
  generateTransactionId,
  getExtension,
  mapSourceToTargetPath,
  MergeToolRegistry,
  normalizeDepotRoot,
  parseDescribeOutput,
  parseOpenedOutput,
  parseP4WhereOutput,
  parseTaggedChanges,
  PIPELINE_STEP_ORDER,
  replaceChangeFormDescription,
  resolveMergeToolArgs,
  summarizeP4Error,
} from '../electron/main/p4Merge'
import {
  buildRedmineIssueUrl,
  findWorkspaceByBranch,
  humanizeDate,
  parseRedmineRefs,
  recommendTargetBranch,
  resolveWorkspaceBranch,
  sortWorkspacesByBranch,
} from '../src/services/p4Merge'

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
  it('构造 p4 -c <client> integrate -c <targetChange> <source>#<rev> <target>（单文件）', () => {
    const args = buildIntegrateArgs({
      targetClient: 'chenzhixu_C7_Weekly',
      targetChange: '2150001',
      file: {
        sourcePath: '//C7/Development/Mainline/Client/A.lua',
        targetPath: '//C7/Development/Weekly/Client/A.lua',
        sourceRevision: 1,
      },
    })
    expect(args).toEqual([
      '-c', 'chenzhixu_C7_Weekly',
      'integrate', '-c', '2150001',
      '//C7/Development/Mainline/Client/A.lua#1', '//C7/Development/Weekly/Client/A.lua',
    ])
  })

  it('sourceRevision 缺省时不追加 #rev', () => {
    const args = buildIntegrateArgs({
      targetClient: 'c_weekly',
      targetChange: '2150002',
      file: {
        sourcePath: '//C7/Development/Mainline/Client/B.lua',
        targetPath: '//C7/Development/Weekly/Client/B.lua',
      },
    })
    expect(args).toEqual([
      '-c', 'c_weekly',
      'integrate', '-c', '2150002',
      '//C7/Development/Mainline/Client/B.lua', '//C7/Development/Weekly/Client/B.lua',
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

describe('buildRevertArgs', () => {
  it('构造 p4 -c <client> revert <files>（按 depot 路径 revert，不依赖 change 字段）', () => {
    const args = buildRevertArgs({
      targetClient: 'c_weekly',
      files: ['//C7/Weekly/Client/A.lua', '//C7/Weekly/Client/B.json'],
    })
    expect(args).toEqual(['-c', 'c_weekly', 'revert', '//C7/Weekly/Client/A.lua', '//C7/Weekly/Client/B.json'])
  })
  it('单个文件也正常构造', () => {
    const args = buildRevertArgs({ targetClient: 'c_preonline', files: ['//C7/Preonline/Server/C.lua'] })
    expect(args).toEqual(['-c', 'c_preonline', 'revert', '//C7/Preonline/Server/C.lua'])
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
  it('生成 `merge <源描述>` 格式，直接沿用源描述并加 merge 前缀', () => {
    const desc = buildPendingChangeDescription({
      sourceBranch: '//C7/Development/Mainline',
      sourceChange: 2132162,
      targetBranch: '//C7/Development/Weekly',
      user: 'chenzhixu',
      sourceDescription: '增加ksbc table级别的lua化',
    })
    expect(desc).toBe('merge 增加ksbc table级别的lua化')
  })

  it('源描述含 Redmine 单号时保留单号，符合 `merge xxxx #单号 xxx` 形式', () => {
    const desc = buildPendingChangeDescription({
      sourceBranch: '//C7/Development/Mainline',
      sourceChange: 2137156,
      targetBranch: '//C7/Development/Preonline',
      user: 'chenzhixu',
      sourceDescription: '测试merge功能 #361226 【Online】',
    })
    expect(desc).toBe('merge 测试merge功能 #361226 【Online】')
  })

  it('源描述为空时用 `merge <sourceChange>` 兜底，避免 p4 change -i 报 description missing', () => {
    const desc = buildPendingChangeDescription({
      sourceBranch: '//C7/Development/Mainline',
      sourceChange: 2137156,
      targetBranch: '//C7/Development/Preonline',
      user: 'chenzhixu',
      sourceDescription: '',
    })
    expect(desc).toBe('merge 2137156')
  })

  it('源描述仅空白时同样兜底为 `merge <sourceChange>`', () => {
    const desc = buildPendingChangeDescription({
      sourceBranch: '//C7/Development/Mainline',
      sourceChange: 2137156,
      targetBranch: '//C7/Development/Preonline',
      user: 'chenzhixu',
      sourceDescription: '   \n  \t',
    })
    expect(desc).toBe('merge 2137156')
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

describe('buildOpenedArgs（Preflight「目标 Workspace 未提交修改」查询）', () => {
  const CLIENT = 'chenzhixu_C7_Weekly'

  it('查询指定 client 的已打开文件：-C 在子命令之后', () => {
    expect(buildOpenedArgs({ client: CLIENT })).toEqual(['-c', CLIENT, 'opened', '-C', CLIENT])
  })

  it('回归：绝不能带 -a（-a 是全服所有 client，实测本服 80 万+ 条 → 目标工作区永远被判脏）', () => {
    expect(buildOpenedArgs({ client: CLIENT })).not.toContain('-a')
    expect(buildOpenedArgs({ client: CLIENT, files: ['//C7/Release/Preonline/A.lua'] })).not.toContain('-a')
    expect(buildOpenedArgs({ client: CLIENT, change: 2137156 })).not.toContain('-a')
  })

  it('限定文件时文件参数追加在最后', () => {
    expect(buildOpenedArgs({ client: CLIENT, files: ['//a/A.lua', '//a/B.lua'] })).toEqual([
      '-c', CLIENT, 'opened', '-C', CLIENT, '//a/A.lua', '//a/B.lua',
    ])
  })

  it('按 changelist 过滤时不带 -C（p4 会忽略 -C/-u/-a）', () => {
    expect(buildOpenedArgs({ client: CLIENT, change: 2137156 })).toEqual([
      '-c', CLIENT, 'opened', '-c', '2137156',
    ])
  })
})

describe('parseOpenedOutput 的「无已打开文件」文案', () => {
  // 退出码为 0，靠文案判断；三种形态都不能被当成已打开文件
  it('File(s) not opened anywhere.（-C <client> 无文件时）', () => {
    expect(parseOpenedOutput('File(s) not opened anywhere.\n')).toEqual([])
  })
  it('//path/... - file(s) not opened anywhere.（带 file 参数时）', () => {
    expect(parseOpenedOutput('//C7/Release/Preonline/Client/... - file(s) not opened anywhere.\n')).toEqual([])
  })
  it('正常行仍可解析（含 by user@client）', () => {
    const parsed = parseOpenedOutput(
      '//C7/Release/Preonline/Client/A.lua#2 edit default (text) by chenzhixu@chenzhixu_C7_Weekly\n',
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      depotPath: '//C7/Release/Preonline/Client/A.lua',
      revision: '2',
      action: 'edit',
      change: 'default',
      client: 'chenzhixu_C7_Weekly',
    })
  })
})

/*
 * `p4 change -o` 的真实模板（本机 p4 -c chenzhixu_C7_Weekly change -o 输出，CRLF 行尾）.
 * 关键：**Description 是最后一个字段**，其后只有占位行与一个空行，没有其它 `Field:` 行.
 */
const P4_CHANGE_FORM = [
  '# A Perforce Change Specification.',
  '#',
  '#  Description: Comments about the changelist.  Required.',
  '',
  'Change:\tnew',
  '',
  'Client:\tchenzhixu_C7_Weekly',
  '',
  'User:\tchenzhixu',
  '',
  'Status:\tnew',
  '',
  'Description:',
  '\t<enter description here>',
  '',
  '',
].join('\r\n')

const MERGE_DESCRIPTION = [
  '[Cross Branch Merge]',
  'Source: //C7/Development/Mainline',
  'Source Change: 2137156',
  '',
  'Original Description:',
  'fix bug',
].join('\n')

describe('replaceChangeFormDescription（创建 Pending CL 的表单替换）', () => {
  it('回归：Description 是最后一个字段时也能替换成功（旧正则的前瞻永不成立 → 静默失效）', () => {
    const out = replaceChangeFormDescription(P4_CHANGE_FORM, MERGE_DESCRIPTION)
    expect(out).not.toBe(P4_CHANGE_FORM)
    expect(out).not.toContain('<enter description here>')
    expect(out).toContain('Description:\r\n\t[Cross Branch Merge]')
  })

  it('描述每行都补 tab 缩进（含空行），否则会被 p4 当成新字段名', () => {
    const out = replaceChangeFormDescription(P4_CHANGE_FORM, MERGE_DESCRIPTION)
    const lines = out.split('\r\n')
    const di = lines.indexOf('Description:')
    expect(lines.slice(di + 1, di + 7)).toEqual([
      '\t[Cross Branch Merge]',
      '\tSource: //C7/Development/Mainline',
      '\tSource Change: 2137156',
      '\t',
      '\tOriginal Description:',
      '\tfix bug',
    ])
  })

  it('其它字段原样保留，末尾补空行，行尾沿用模板的 CRLF', () => {
    const out = replaceChangeFormDescription(P4_CHANGE_FORM, MERGE_DESCRIPTION)
    expect(out).toContain('Change:\tnew\r\n')
    expect(out).toContain('Client:\tchenzhixu_C7_Weekly\r\n')
    expect(out).toContain('User:\tchenzhixu\r\n')
    expect(out.endsWith('\r\n\r\n')).toBe(true)
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('LF 模板保持 LF', () => {
    const lf = ['Change:\tnew', 'Description:', '\t<enter description here>', ''].join('\n')
    expect(replaceChangeFormDescription(lf, 'a\nb')).toBe(
      ['Change:\tnew', 'Description:', '\ta', '\tb', '', ''].join('\n'),
    )
  })

  it('模板里没有 Description 字段时原样返回（调用方据此判错，不直接回灌）', () => {
    const noDesc = ['Change:\tnew', 'Client:\tx'].join('\r\n')
    expect(replaceChangeFormDescription(noDesc, 'abc')).toBe(noDesc)
  })
})

describe('summarizeP4Error', () => {
  it('取首行 + 末行（p4 把具体原因放在最后，首行是笼统错误）', () => {
    const raw = [
      'Error in change specification.',
      'Error detected at line 31.',
      'Change description missing.  You must enter one.',
    ].join('\r\n')
    expect(summarizeP4Error(raw)).toBe(
      'Error in change specification. / Change description missing.  You must enter one.',
    )
  })

  it('单行 / 空输入', () => {
    expect(summarizeP4Error('Change 2137157 created.')).toBe('Change 2137157 created.')
    expect(summarizeP4Error('   \r\n  ')).toBe('')
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

/*
 * 「猜你想选」的分支判定 / 方向推荐.
 * 样本取自本机真实 client（p4 -ztag clients -u chenzhixu）过滤出 Root 存在的本地工作区：
 *   chenzhixu_C7_Mainline  //C7/Development/Mainline
 *   chenzhixu_C7_Weekly    //C7/Release/Preonline       ← 名字不含 Preonline，必须按 stream 判
 *   chenzhixu_C7_Online    //C7/Release/Online
 *   chenzhixu_onlineDesign //C7/Release/vOnlineDesign   ← 名字含 online，但不是 Online 分支
 */
const LOCAL_WORKSPACES = [
  { name: 'chenzhixu_C7_Mainline', stream: '//C7/Development/Mainline' },
  { name: 'chenzhixu_C7_Weekly', stream: '//C7/Release/Preonline' },
  { name: 'chenzhixu_C7_Online', stream: '//C7/Release/Online' },
  { name: 'chenzhixu_onlineDesign', stream: '//C7/Release/vOnlineDesign' },
  { name: 'czx_test_switchStream', stream: '//C7/Development/vFlowchartTool' },
]

describe('resolveWorkspaceBranch', () => {
  it('按 stream 末段判定三个主分支', () => {
    expect(resolveWorkspaceBranch(LOCAL_WORKSPACES[0])).toBe('mainline')
    expect(resolveWorkspaceBranch(LOCAL_WORKSPACES[1])).toBe('preonline')
    // 回归：旧实现 /(^|_)online($|_)/ 与 /\/online\// 都匹配不到 `//C7/Release/Online`
    //   （前面拼了 client 名、后面没有斜杠），Online 被判为 null → Target 就没有「猜你想选」
    expect(resolveWorkspaceBranch(LOCAL_WORKSPACES[2])).toBe('online')
  })

  it('名字里含 online / preonline 的其它 stream 不误判', () => {
    expect(resolveWorkspaceBranch({ name: 'chenzhixu_onlineDesign', stream: '//C7/Release/vOnlineDesign' })).toBeNull()
    expect(resolveWorkspaceBranch({ name: 'x_3569', stream: '//C7/Release/vPreonlineServerDeploy' })).toBeNull()
  })

  it('stream 优先于 client 名', () => {
    expect(resolveWorkspaceBranch({ name: 'chenzhixu_C7_Weekly' })).toBe('weekly')
    expect(resolveWorkspaceBranch({ name: 'chenzhixu_C7_Weekly', stream: '//C7/Release/Preonline' })).toBe('preonline')
  })

  it('无 stream 时回退按 client 名分段匹配（不做子串匹配）', () => {
    expect(resolveWorkspaceBranch({ name: 'chenzhixu_C7_Mainline' })).toBe('mainline')
    expect(resolveWorkspaceBranch({ name: 'chenzhixu_C7_Online' })).toBe('online')
    expect(resolveWorkspaceBranch({ name: 'chenzhixu_onlineDesign' })).toBeNull()
    expect(resolveWorkspaceBranch({ name: 'chenzhixu_MainlineBackup' })).toBeNull()
  })

  it('大小写不敏感；空值返回 null', () => {
    expect(resolveWorkspaceBranch({ name: 'a', stream: '//c7/release/PREONLINE' })).toBe('preonline')
    expect(resolveWorkspaceBranch(undefined)).toBeNull()
  })
})

describe('recommendTargetBranch（Merge 方向推荐）', () => {
  it('Mainline → Preonline、Preonline → Online', () => {
    expect(recommendTargetBranch(LOCAL_WORKSPACES[0])).toBe('preonline')
    expect(recommendTargetBranch(LOCAL_WORKSPACES[1])).toBe('online')
  })

  it('末端分支与未知分支不推荐', () => {
    expect(recommendTargetBranch(LOCAL_WORKSPACES[2])).toBeNull()
    expect(recommendTargetBranch({ name: 'a', stream: '//C7/Development/ArtDev' })).toBeNull()
    expect(recommendTargetBranch(undefined)).toBeNull()
  })
})

describe('findWorkspaceByBranch / sortWorkspacesByBranch', () => {
  it('按分支取到唯一匹配的 workspace', () => {
    expect(findWorkspaceByBranch(LOCAL_WORKSPACES, 'mainline')?.name).toBe('chenzhixu_C7_Mainline')
    expect(findWorkspaceByBranch(LOCAL_WORKSPACES, 'preonline')?.name).toBe('chenzhixu_C7_Weekly')
    expect(findWorkspaceByBranch(LOCAL_WORKSPACES, 'online')?.name).toBe('chenzhixu_C7_Online')
  })

  it('branch 为 null 时返回 undefined（不落到错误的工作区）', () => {
    expect(findWorkspaceByBranch(LOCAL_WORKSPACES, null)).toBeUndefined()
  })

  it('排序：Mainline > Preonline > Online > 其它（按名）', () => {
    expect(sortWorkspacesByBranch(LOCAL_WORKSPACES).map((w) => w.name)).toEqual([
      'chenzhixu_C7_Mainline',
      'chenzhixu_C7_Weekly',
      'chenzhixu_C7_Online',
      'chenzhixu_onlineDesign',
      'czx_test_switchStream',
    ])
  })
})

/*
 * Excel 三路合并（KeyExcelMerge.exe VCSTool=none）相关纯函数.
 * DeskTop 用 p4 print 自取 base/their + p4 where 取 mine，再调用 KeyExcelMerge 做纯本地合并.
 */
describe('buildP4PrintArgs', () => {
  it('带数字 revision 追加 #rev', () => {
    expect(buildP4PrintArgs({
      client: 'c_weekly',
      outputFile: 'E:\\tmp\\base.xlsx',
      depotPath: '//C7/Dev/Weekly/Client/A.xlsx',
      revision: 3,
    })).toEqual([
      '-c', 'c_weekly', 'print', '-q', '-o', 'E:\\tmp\\base.xlsx',
      '//C7/Dev/Weekly/Client/A.xlsx#3',
    ])
  })
  it('revision=have 取当前 workspace 已有版本（base 共同祖先）', () => {
    expect(buildP4PrintArgs({
      client: 'c_weekly',
      outputFile: 'E:\\tmp\\base.xlsx',
      depotPath: '//C7/Dev/Weekly/Client/A.xlsx',
      revision: 'have',
    })).toEqual([
      '-c', 'c_weekly', 'print', '-q', '-o', 'E:\\tmp\\base.xlsx',
      '//C7/Dev/Weekly/Client/A.xlsx#have',
    ])
  })
  it('revision 缺省时不追加 #rev（取 head）', () => {
    expect(buildP4PrintArgs({
      client: 'c_mainline',
      outputFile: '/tmp/their.xlsx',
      depotPath: '//C7/Dev/Mainline/Client/A.xlsx',
    })).toEqual([
      '-c', 'c_mainline', 'print', '-q', '-o', '/tmp/their.xlsx',
      '//C7/Dev/Mainline/Client/A.xlsx',
    ])
  })
})

describe('buildP4WhereArgs', () => {
  it('构造 p4 -c <client> where <depotPath>', () => {
    expect(buildP4WhereArgs({ client: 'c_weekly', depotPath: '//C7/Dev/Weekly/Client/A.xlsx' }))
      .toEqual(['-c', 'c_weekly', 'where', '//C7/Dev/Weekly/Client/A.xlsx'])
  })
})

describe('parseP4WhereOutput', () => {
  it('取三列输出的第三列（本地路径）', () => {
    const output = '//C7/Dev/Weekly/Client/A.xlsx //c_weekly/Client/A.xlsx E:\\Project\\C7_project\\Client\\A.xlsx\n'
    expect(parseP4WhereOutput(output)).toBe('E:\\Project\\C7_project\\Client\\A.xlsx')
  })
  it('多行取第一行（p4 where 单文件只返回一行）', () => {
    const output = '//a //b /c\n//x //y /z\n'
    expect(parseP4WhereOutput(output)).toBe('/c')
  })
  it('非 // 开头或列数不足返回 null', () => {
    expect(parseP4WhereOutput('no map\n')).toBeNull()
    expect(parseP4WhereOutput('//a //b\n')).toBeNull()
    expect(parseP4WhereOutput('')).toBeNull()
  })
})

describe('buildExcelMergeArgs', () => {
  it('构造 ExcelFileList=base,mine,their;... + VCSTool=none + ExcelBackupPath', () => {
    const args = buildExcelMergeArgs({
      contexts: [
        {
          targetDepotPath: '//C7/Dev/Weekly/Client/A.xlsx',
          baseFile: 'E:\\bk\\base_A.xlsx',
          theirFile: 'E:\\bk\\their_A.xlsx',
          mineFile: 'E:\\ws\\Client\\A.xlsx',
        },
        {
          targetDepotPath: '//C7/Dev/Weekly/Client/B.xlsx',
          baseFile: 'E:\\bk\\base_B.xlsx',
          theirFile: 'E:\\bk\\their_B.xlsx',
          mineFile: 'E:\\ws\\Client\\B.xlsx',
        },
      ],
      backupRootDir: 'E:\\bk',
    })
    expect(args).toEqual([
      'ExcelFileList=E:\\bk\\base_A.xlsx,E:\\ws\\Client\\A.xlsx,E:\\bk\\their_A.xlsx;E:\\bk\\base_B.xlsx,E:\\ws\\Client\\B.xlsx,E:\\bk\\their_B.xlsx',
      'VCSTool=none',
      'ExcelBackupPath=E:\\bk',
    ])
  })
  it('单个文件也正确拼接', () => {
    const args = buildExcelMergeArgs({
      contexts: [
        {
          targetDepotPath: '//C7/Dev/Weekly/Client/A.xlsx',
          baseFile: '/bk/base_A.xlsx',
          theirFile: '/bk/their_A.xlsx',
          mineFile: '/ws/A.xlsx',
        },
      ],
      backupRootDir: '/bk',
    })
    expect(args[0]).toBe('ExcelFileList=/bk/base_A.xlsx,/ws/A.xlsx,/bk/their_A.xlsx')
    expect(args[1]).toBe('VCSTool=none')
    expect(args[2]).toBe('ExcelBackupPath=/bk')
  })
})

describe('buildResolveAcceptYoursArgs', () => {
  it('构造 p4 -c <client> resolve -ay（accept yours，用本地 merged 结果解决冲突）', () => {
    expect(buildResolveAcceptYoursArgs({ targetClient: 'c_weekly' }))
      .toEqual(['-c', 'c_weekly', 'resolve', '-ay'])
  })
  it('传入 excel 文件列表时追加到末尾', () => {
    const args = buildResolveAcceptYoursArgs({
      targetClient: 'c_weekly',
      files: ['//C7/Dev/Weekly/Client/A.xlsx', '//C7/Dev/Weekly/Client/B.xlsx'],
    })
    expect(args).toEqual([
      '-c', 'c_weekly', 'resolve', '-ay',
      '//C7/Dev/Weekly/Client/A.xlsx', '//C7/Dev/Weekly/Client/B.xlsx',
    ])
  })
})

describe('EXCEL_EXTENSIONS', () => {
  it('覆盖 xlsx / xlsm / xls 三种 Excel 扩展名', () => {
    expect(EXCEL_EXTENSIONS.has('.xlsx')).toBe(true)
    expect(EXCEL_EXTENSIONS.has('.xlsm')).toBe(true)
    expect(EXCEL_EXTENSIONS.has('.xls')).toBe(true)
  })
  it('非 Excel 扩展名不命中（避免误走 KeyExcelMerge）', () => {
    expect(EXCEL_EXTENSIONS.has('.lua')).toBe(false)
    expect(EXCEL_EXTENSIONS.has('.uasset')).toBe(false)
    expect(EXCEL_EXTENSIONS.has('.csv')).toBe(false)
  })
})
