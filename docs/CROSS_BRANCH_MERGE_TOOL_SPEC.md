# Cross Branch Merge Tool Specification

## 1. 项目概述

开发一个基于 **Electron + React + Ant Design** 的跨分支 Perforce Merge 工具。

工具的核心目标：

> 在不依赖 P4V 的情况下，完成从 Perforce 源分支 Workspace 到目标分支 Workspace 的 Changelist 级 Merge，并提供针对不同文件类型的可配置 Merge Tool。

典型使用场景：

```text
Source Branch
    │
    │ Source Workspace
    │
    ├── Changelist 2132162
    │      ├── A.lua
    │      ├── B.xlsx
    │      └── C.json
    │
    ▼
Merge
    │
    ├── Lua → 普通文本 Merge
    ├── JSON → 普通文本 Merge
    └── XLSX → KeyExcelMergeTool
    │
    ▼
Target Workspace
    │
    └── Pending Changelist
```

工具必须尽量使用 Perforce CLI 完成核心操作，不依赖 P4V。

---

# 2. 核心设计原则

## 2.1 P4V 非核心依赖

禁止将 P4V 作为 Merge 流程的核心执行器。

允许：

* 调用 `p4.exe`
* 调用 `p4merge.exe`
* 调用公司内部 Merge Tool
* 调用其他配置的外部 Merge Tool

不允许：

* 通过启动 P4V 再模拟 UI 操作完成 Merge
* 通过 P4V Window/UI Automation 完成核心流程
* 假设用户一定安装了某个特定版本的 P4V

核心能力必须可以在：

```text
Electron
    ↓
Node.js Main Process
    ↓
p4.exe
```

中独立完成。

---

# 3. 技术架构

推荐架构：

```text
┌──────────────────────────────────────────────┐
│                  Electron                    │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ React + Ant Design                     │  │
│  │                                        │  │
│  │ Workspace Selector                     │  │
│  │ Changelist Selector                    │  │
│  │ File Preview                           │  │
│  │ Merge Configuration                    │  │
│  │ Merge Progress                         │  │
│  │ Conflict Resolution                    │  │
│  └────────────────────────────────────────┘  │
│                       │ IPC                  │
│  ┌────────────────────────────────────────┐  │
│  │ Electron Main Process                  │  │
│  │                                        │  │
│  │ P4 Service                             │  │
│  │ Workspace Service                      │  │
│  │ Changelist Service                     │  │
│  │ Merge Service                          │  │
│  │ Resolve Service                        │  │
│  │ Merge Tool Service                     │  │
│  │ Redmine Parser                         │  │
│  └────────────────────────────────────────┘  │
│                       │                      │
└───────────────────────┼──────────────────────┘
                        │
              ┌─────────┴──────────┐
              │                    │
          p4.exe              Merge Tools
              │                    │
       Perforce Server        p4merge.exe
                                   │
                             KeyExcelMerge.exe
```

---

# 4. 进程与权限模型

## 4.1 Renderer 禁止直接执行系统命令

React Renderer 不允许直接调用：

* `child_process`
* `p4.exe`
* `p4merge.exe`
* 任意外部程序

所有系统操作必须通过 Electron IPC：

```text
Renderer
   ↓ IPC
Main Process
   ↓
P4 Service
   ↓
p4.exe
```

---

# 5. P4 CLI 基础能力

P4 Service 应统一封装所有 P4 CLI 调用。

建议：

```text
P4Service
├── info()
├── login()
├── clients()
├── client()
├── changes()
├── describe()
├── files()
├── opened()
├── sync()
├── integrate()
├── resolve()
├── revert()
├── edit()
├── add()
├── delete()
├── shelve()
├── submit()
└── run()
```

所有命令必须统一处理：

* exit code
* stdout
* stderr
* charset
* command timeout
* cancellation
* 用户身份
* P4PORT
* P4USER
* P4CLIENT
* P4CHARSET

---

# 6. Workspace 模型

Workspace 是整个工具的核心对象。

```ts
interface P4Workspace {
    name: string
    owner: string
    root: string
    stream?: string
    server: string
    description?: string
}
```

UI 中需要区分：

```text
Source Workspace
Target Workspace
```

例如：

```text
Source Workspace:
    chenzhixu_C7_Mainline

Target Workspace:
    chenzhixu_C7_Weekly
```

---

# 7. Workspace 选择

## 7.1 Source Workspace

用户可以选择当前 P4 用户拥有的 Workspace。

优先展示：

* 当前用户 Workspace
* 当前机器上的 Workspace
* 当前 Workspace
* 最近使用 Workspace

支持搜索。

---

## 7.2 Target Workspace

Target Workspace 与 Source Workspace 独立选择。

允许：

```text
Source Workspace == Target Workspace
```

但默认禁止执行跨分支 Merge。

如果检测到两个 Workspace 指向同一个 Client，应提示：

```text
源 Workspace 与目标 Workspace 相同，无法执行跨分支 Merge。
```

---

# 8. Source Changelist 查询

第一阶段支持：

> 用户选择 Source Workspace → 查看该 Workspace 对应用户的 Submitted Changelist。

核心数据：

```ts
interface P4Changelist {
    change: number
    user: string
    client: string
    date: string
    description: string
    status: "submitted" | "pending"
}
```

查询逻辑建议：

```bash
p4 changes -s submitted -u <user> -c <sourceWorkspace>
```

必要时再根据 Source Workspace 的 View 进行路径过滤。

---

# 9. Changelist 展示

UI 展示：

| Change  | User      | Date       | Description             | Files |
| ------- | --------- | ---------- | ----------------------- | ----: |
| 2132162 | chenzhixu | 2026-xx-xx | 增加 ksbc table 级别的 lua 化 |     1 |
| 2132150 | chenzhixu | 2026-xx-xx | xxx                     |     5 |

用户选择一个 Changelist 后，读取：

```bash
p4 describe -s <change>
```

或者：

```bash
p4 describe <change>
```

获得：

* 文件列表
* 文件 Action
* Revision
* Depot Path
* Change Description

---

# 10. Changelist File Model

```ts
interface P4ChangeFile {
    depotPath: string
    revision: number
    action: "add" | "edit" | "delete" | "move/add" | "move/delete"
    fileType?: string
}
```

例如：

```text
Revision : 2132162

edit
//C7/Development/Mainline/Client/Content/Script/Framework/Utils/LuaCommon/Managers/TableDataManager.lua
```

解析后：

```json
{
    "depotPath": "//C7/Development/Mainline/Client/Content/Script/Framework/Utils/LuaCommon/Managers/TableDataManager.lua",
    "revision": 2132162,
    "action": "edit"
}
```

---

# 11. Branch / Depot Path 分析

工具必须能够识别：

```text
Source Branch
Target Branch
```

例如：

```text
Source:
    //C7/Development/Mainline/...

Target:
    //C7/Development/Weekly/...
```

不要简单通过字符串替换实现 Branch Mapping。

应该设计独立的：

```ts
BranchMappingService
```

负责：

```text
Source Depot Path
        ↓
Branch Mapping
        ↓
Target Depot Path
```

第一阶段可以支持配置：

```json
{
    "source": "//C7/Development/Mainline",
    "target": "//C7/Development/Weekly"
}
```

后续可以根据 Perforce Stream 自动获取 Branch Mapping。

---

# 12. Merge 前 Sync 策略

Merge 前必须确保 Target Workspace 中涉及的文件是最新状态。

但是：

> 不允许默认执行整个 Workspace 的 `p4 sync`。

因为 C7 Workspace 可能非常大。

---

# 13. 最小目录 Sync

根据 Source Changelist 的文件列表计算需要同步的最小目录范围。

例如 Change：

```text
//C7/Mainline/Client/A.xlsx
//C7/Mainline/Client/B.lua
//C7/Mainline/Client/Config/C.json
```

不应该：

```bash
p4 sync //C7/Weekly/...
```

而应该只同步：

```text
Target/Client/A.xlsx
Target/Client/B.lua
Target/Client/Config/C.json
```

如果需要目录级同步，可以计算：

```text
Target/Client
Target/Client/Config
```

但默认优先使用**文件级 Sync**。

---

# 14. Sync 策略

提供三种模式：

### Mode A：File

只同步 Changelist 涉及的目标文件。

```bash
p4 sync <target-file-list>
```

默认模式。

---

### Mode B：Directory

计算 Changelist 文件共同的最小目录，然后同步目录。

```bash
p4 sync <target-directory>/...
```

仅在用户明确选择时使用。

---

### Mode C：Manual

不自动 Sync。

仅检测：

```text
Target Workspace 当前状态
```

并提示用户自行处理。

---

# 15. Sync 前安全检查

执行 Sync 前必须检查：

```bash
p4 opened -c default
```

以及：

```bash
p4 opened -a <target-files>
```

检查目标 Workspace 是否存在：

* 未提交修改
* 已打开文件
* add
* edit
* delete
* move

如果存在可能影响 Merge 的 Pending 修改：

```text
目标 Workspace 存在未提交修改。

可能影响：
    12 个文件

是否继续？
```

默认：

```text
取消
```

禁止工具静默覆盖用户本地修改。

---

# 16. Merge 执行模型

Merge 分成两个阶段：

```text
P4 Integration
        ↓
P4 Resolve
        ↓
External Merge Tool
```

不要把：

```text
p4 integrate
```

和：

```text
p4merge
```

混为一个操作。

---

# 17. P4 Integrate

目标是让 Perforce 生成正确的 Merge/Resolve 状态。

基本流程：

```bash
p4 integrate <source> <target>
```

然后：

```bash
p4 resolve
```

具体命令参数由 `MergeService` 根据 Workspace / Branch Mapping 生成。

推荐优先使用：

```bash
p4 integrate -c <targetPendingChange> ...
```

让 Merge 产生的文件直接进入指定 Pending Changelist。

---

# 18. Pending Changelist

工具必须支持自动创建 Pending Changelist。

例如：

```text
Cross Branch Merge:
2132162 Mainline -> Weekly
```

生成：

```text
Pending Change:
2150001

Description:
[Cross Branch Merge]
Source:
    //C7/Development/Mainline

Source Change:
    2132162

Target:
    //C7/Development/Weekly

User:
    chenzhixu

Original Description:
    增加ksbc table级别的lua化
```

建议支持模板：

```text
[Cross Branch Merge]
Source: {sourceBranch}
Source Change: {sourceChange}
Target: {targetBranch}

{sourceDescription}
```

---

# 19. Merge Tool 抽象

Merge Tool 不允许写死在业务代码中。

设计：

```ts
interface MergeTool {
    id: string
    name: string
    executable: string
    arguments: string
    extensions: string[]
    priority?: number
}
```

例如：

```json
{
    "id": "key-excel-merge",
    "name": "KeyExcelMerge",
    "executable": "Design/Tool/KeyExcelMergeTool/KeyExcelMerge/KeyExcelMerge.exe",
    "arguments": "%b %1 %2 %r VCSTool=p4",
    "extensions": [
        ".xlsx",
        ".xlsm"
    ]
}
```

---

# 20. KeyExcelMergeTool

内部 Excel Merge Tool：

```text
Application:
Design/Tool/KeyExcelMergeTool/KeyExcelMerge/KeyExcelMerge.exe

Arguments:
%b %1 %2 %r VCSTool=p4
```

实际执行前必须解析：

```text
%b
%1
%2
%r
```

这些变量不能直接交给 shell。

应该由：

```text
MergeToolService
```

解析为实际文件路径。

---

# 21. Merge Tool 参数模型

统一定义：

```ts
interface MergeToolContext {
    baseFile: string
    sourceFile: string
    targetFile: string
    resultFile: string

    sourceDepotPath: string
    targetDepotPath: string

    sourceRevision?: number
    targetRevision?: number
}
```

参数模板：

```text
%b
%1
%2
%r
```

映射关系必须通过配置定义，而不是在业务代码中硬编码。

例如：

```json
{
    "variables": {
        "%b": "baseFile",
        "%1": "sourceFile",
        "%2": "targetFile",
        "%r": "resultFile"
    }
}
```

---

# 22. Merge Tool 类型

初期支持：

### Text

```text
.lua
.json
.ini
.cfg
.xml
.txt
```

默认：

```text
p4merge
```

---

### Excel

```text
.xlsx
.xlsm
.xls
```

默认：

```text
KeyExcelMerge
```

---

### Binary

例如：

```text
.uasset
.umap
.pak
```

默认不自动 Merge。

显示：

```text
该文件类型不支持自动 Merge。
```

由用户选择：

```text
Accept Source
Accept Target
Skip
```

---

# 23. P4Merge

P4Merge 作为通用文本 Merge Tool。

安装路径不要写死。

支持：

```text
配置路径
环境变量
自动探测
用户手动选择
```

例如：

```text
C:\Program Files\Perforce\p4merge.exe
```

程序启动时检测：

```text
p4merge.exe
```

如果找不到：

```text
未找到 P4Merge。

请配置 P4Merge 可执行文件路径。
```

---

# 24. Merge Tool 配置优先级

优先级：

```text
File Extension
    ↓
Perforce File Type
    ↓
Configured Merge Tool
    ↓
Default P4Merge
    ↓
Manual Resolution
```

例如：

```text
.xlsx
    ↓
KeyExcelMerge

.lua
    ↓
P4Merge

.json
    ↓
P4Merge

.uasset
    ↓
Manual
```

---

# 25. Merge Tool 注册中心

实现：

```ts
MergeToolRegistry
```

接口：

```ts
register(tool: MergeTool)

resolve(file: P4ChangeFile): MergeTool | null

list(): MergeTool[]

test(tool: MergeTool): Promise<boolean>
```

配置示例：

```json
{
    "mergeTools": [
        {
            "id": "key-excel",
            "name": "KeyExcelMerge",
            "executable": "...",
            "extensions": [".xlsx", ".xlsm"],
            "arguments": "%b %1 %2 %r VCSTool=p4"
        },
        {
            "id": "p4merge",
            "name": "P4Merge",
            "executable": "...",
            "extensions": [
                ".lua",
                ".json",
                ".txt",
                ".xml",
                ".ini"
            ],
            "arguments": "..."
        }
    ]
}
```

---

# 26. Resolve 流程

推荐：

```text
p4 integrate
       ↓
p4 resolve -n
       ↓
是否存在冲突？
       │
       ├── No
       │    ↓
       │  p4 resolve -am
       │
       └── Yes
            ↓
       Merge Tool
            ↓
       用户解决
            ↓
       p4 resolve
```

---

# 27. Resolve 分类

工具需要识别：

```text
Auto Resolved
Manual Resolved
Conflict
Skipped
Binary Conflict
```

UI：

| File                 | Status   | Tool          |
| -------------------- | -------- | ------------- |
| TableDataManager.lua | Auto     | P4Merge       |
| Config.xlsx          | Manual   | KeyExcelMerge |
| Test.uasset          | Conflict | Manual        |

---

# 28. Merge 完成后的 Pending 状态

Merge 成功后：

```bash
p4 opened -c <targetChange>
```

确认文件已经进入目标 Pending Changelist。

最终状态：

```text
Target Workspace
    ↓
Pending Changelist
    ↓
Merged Files
```

工具本身**默认不自动 Submit**。

---

# 29. Submit 原则

第一阶段：

```text
禁止自动 Submit
```

只执行：

```text
Merge
Resolve
Pending Changelist
```

用户可以通过 P4V / P4 / 其他工具自行 Review 后 Submit。

后续版本可以增加：

```text
Submit
```

但必须作为独立显式操作。

---

# 30. Merge Preview

正式 Merge 前必须提供 Preview。

显示：

```text
Source:
    Workspace: chenzhixu_C7_Mainline
    Change: 2132162

Target:
    Workspace: chenzhixu_C7_Weekly

Files:
    8

Auto Merge:
    5

Need Resolve:
    2

Unsupported:
    1
```

用户确认后才执行实际 Merge。

---

# 31. File Diff Preview

用户选择 Changelist 后，可以查看：

```text
Source File
Target File
Base File
```

并显示：

```text
Source Revision
Target Revision
Base Revision
```

对于文本文件：

```text
P4Merge
```

对于 Excel：

```text
KeyExcelMerge
```

---

# 32. Redmine 集成

第二阶段支持：

```text
Redmine Issue
        ↓
History
        ↓
Revision
        ↓
P4 Changelist
        ↓
Source Workspace
        ↓
Source Branch
        ↓
Target Workspace
        ↓
Merge
```

---

# 33. Redmine Issue 输入

用户输入：

```text
Redmine ID
```

例如：

```text
C7-12345
```

工具获取：

* Issue
* Description
* History
* Journals
* Notes

---

# 34. Redmine History Parser

重点解析类似：

```text
Revision : 2132162
Message : 增加ksbc table级别的lua化 (submit by chenzhixu)
edit : //C7/Development/Mainline/Client/Content/Script/Framework/Utils/LuaCommon/Managers/TableDataManager.lua
```

Parser 输出：

```ts
interface RedmineRevision {
    revision: number
    message?: string
    user?: string
    files: RedmineRevisionFile[]
}
```

例如：

```json
{
    "revision": 2132162,
    "message": "增加ksbc table级别的lua化",
    "user": "chenzhixu",
    "files": [
        {
            "action": "edit",
            "path": "//C7/Development/Mainline/Client/Content/Script/Framework/Utils/LuaCommon/Managers/TableDataManager.lua"
        }
    ]
}
```

---

# 35. Redmine Revision 校验

不能只相信 Redmine History。

解析出：

```text
Revision = 2132162
```

之后必须调用 P4：

```bash
p4 describe 2132162
```

进行二次验证。

需要确认：

```text
Revision 是否存在
User 是否匹配
Description 是否匹配
File 是否匹配
```

如果不匹配：

```text
Redmine Revision 与 Perforce Changelist 信息不一致。
```

不得直接 Merge。

---

# 36. Source Workspace 自动识别

如果 Redmine 中存在：

```text
Revision : 2132162
```

则：

```bash
p4 describe 2132162
```

得到：

```text
Client
User
Files
```

例如：

```text
Client:
    chenzhixu_C7_Mainline

User:
    chenzhixu
```

工具据此尝试自动匹配 Source Workspace：

```text
P4 Changelist Client
        ↓
Workspace
```

如果 Client 不存在本地：

```text
该 Changelist 对应 Workspace 当前不可用。
```

但允许用户手动选择 Source Workspace。

---

# 37. Redmine → P4 Source Flow

最终：

```text
Redmine Issue
      ↓
Parse History
      ↓
Revision 2132162
      ↓
p4 describe 2132162
      ↓
Source Client
      ↓
Source Workspace
      ↓
Source Branch
      ↓
Target Workspace
      ↓
Target Branch
      ↓
Preview
      ↓
Merge
```

---

# 38. 多 Revision 支持

Redmine Issue 可能存在：

```text
Revision : 2132162
Revision : 2132175
Revision : 2132201
```

因此不能假设一个 Issue 只有一个 Changelist。

UI：

```text
Redmine Issue
    ├── 2132162
    ├── 2132175
    └── 2132201
```

用户可以：

```text
[ ] 2132162
[ ] 2132175
[ ] 2132201
```

然后选择：

```text
Merge Selected Revisions
```

---

# 39. Changelist 依赖关系

如果：

```text
2132162
2132175
2132201
```

存在父子依赖，工具必须提醒。

例如：

```text
2132175 修改依赖 2132162。

仅 Merge 2132175 可能导致代码不完整。
```

第一阶段可以只提示，不自动解决依赖。

---

# 40. Merge Transaction

一次 Merge 操作必须具有唯一 Transaction ID。

例如：

```text
Merge Transaction:
    MERGE-20260911-00123
```

记录：

```json
{
    "transactionId": "MERGE-20260911-00123",
    "sourceWorkspace": "chenzhixu_C7_Mainline",
    "targetWorkspace": "chenzhixu_C7_Weekly",
    "sourceChanges": [2132162],
    "targetChange": 2150001,
    "status": "completed"
}
```

---

# 41. 操作日志

每一步都需要记录：

```text
[INFO] Source Workspace: ...
[INFO] Target Workspace: ...
[INFO] Source Change: 2132162
[INFO] Target Change: 2150001

[INFO] Sync:
    //C7/Development/Weekly/Client/...

[INFO] Integrate:
    ...

[INFO] Resolve:
    ...

[INFO] Merge Tool:
    KeyExcelMerge

[INFO] Result:
    success
```

错误必须包含：

```text
Command
Exit Code
stdout
stderr
```

---

# 42. 错误处理

典型错误：

### P4 未登录

```text
P4 authentication required.
```

---

### Workspace 不存在

```text
Workspace does not exist.
```

---

### Workspace 不属于当前用户

```text
Workspace is not owned by current user.
```

---

### 文件存在本地修改

```text
Target workspace contains local modifications.
```

---

### Sync 失败

停止 Merge。

---

### Integrate 失败

停止 Resolve。

---

### Merge Tool 启动失败

显示：

```text
Failed to launch merge tool.

Tool:
    KeyExcelMerge

Executable:
    ...

Exit Code:
    ...
```

---

### Merge Tool 非 0 返回值

不能简单认为失败。

不同工具可能定义不同退出码。

因此 Merge Tool 配置增加：

```json
{
    "successExitCodes": [0],
    "cancelExitCodes": [1]
}
```

后续允许扩展。

---

# 43. Cancellation

长时间运行的：

```text
p4 sync
p4 integrate
p4 resolve
external merge tool
```

必须支持取消。

取消时不能直接杀掉整个 Electron。

应：

```text
AbortController
    ↓
Process.kill()
```

同时更新 Transaction：

```text
status = cancelled
```

---

# 44. 不允许自动执行的危险操作

默认禁止：

```text
p4 revert
p4 clean
p4 sync -f
p4 submit
```

尤其：

```text
p4 revert
```

不能作为 Merge 失败后的自动清理方案。

如果需要 Cleanup：

```text
用户显式点击 Cleanup
```

并明确显示会影响哪些文件。

---

# 45. Merge 前 Workspace 状态

执行前检查：

```text
Source Workspace
    ├── valid
    └── clean enough

Target Workspace
    ├── valid
    ├── logged in
    ├── mapping valid
    └── no dangerous opened files
```

定义：

```ts
interface WorkspacePreflightResult {
    valid: boolean
    warnings: string[]
    errors: string[]
    openedFiles: string[]
}
```

---

# 46. Branch Mapping 验证

Merge 前必须验证：

```text
Source Path
Target Path
```

确实属于两个不同 Branch。

例如：

```text
Source:
    //C7/Development/Mainline/Client/...

Target:
    //C7/Development/Weekly/Client/...
```

如果发现：

```text
Source == Target
```

直接拒绝。

---

# 47. 最小 Merge 范围

默认只 Merge：

```text
用户选择的 Changelist
```

不能因为 Branch Mapping 存在就执行：

```text
整个 Branch Merge
```

例如：

```text
Change 2132162
```

只处理：

```text
2132162 中的文件
```

---

# 48. Delete / Move 文件

必须特殊处理：

```text
delete
move/add
move/delete
```

不能简单按照：

```text
edit
```

处理。

例如：

```text
move:
    A.lua → B.lua
```

需要保留 Perforce 的 move 语义。

---

# 49. 文件类型判断

优先级：

```text
P4 File Type
    ↓
Extension
    ↓
Configured Rule
```

例如：

```text
binary+xlsx
```

不能仅通过：

```text
.xlsx
```

决定最终行为。

---

# 50. Configuration

配置文件建议：

```text
config/
├── p4.json
├── merge-tools.json
├── branches.json
└── redmine.json
```

---

## p4.json

```json
{
    "p4Executable": "p4.exe",
    "p4mergeExecutable": "",
    "defaultCharset": "none"
}
```

---

## branches.json

```json
{
    "branches": [
        {
            "id": "mainline",
            "name": "Mainline",
            "depot": "//C7/Development/Mainline"
        },
        {
            "id": "weekly",
            "name": "Weekly",
            "depot": "//C7/Development/Weekly"
        }
    ]
}
```

---

# 51. UI 页面

推荐页面结构：

```text
Cross Branch Merge
│
├── Manual Merge
│   ├── Source Workspace
│   ├── Source Changelist
│   ├── Target Workspace
│   ├── Preview
│   └── Execute Merge
│
├── Redmine Merge
│   ├── Redmine Issue
│   ├── Revisions
│   ├── Source Workspace
│   ├── Target Workspace
│   ├── Preview
│   └── Execute Merge
│
├── Merge Tasks
│   └── History
│
└── Settings
    ├── P4
    ├── Merge Tools
    ├── Branch Mapping
    └── Redmine
```

---

# 52. Manual Merge 页面

建议采用 Wizard：

```text
1. Source
      ↓
2. Changelist
      ↓
3. Target
      ↓
4. Preflight
      ↓
5. Preview
      ↓
6. Merge
      ↓
7. Resolve
      ↓
8. Result
```

---

# 53. Source 页面

```text
Source Workspace

[ chenzhixu_C7_Mainline ▼ ]

Recent Changelists

┌─────────┬────────────┬────────────────────┐
│ Change  │ User       │ Description        │
├─────────┼────────────┼────────────────────┤
│ 2132162 │ chenzhixu  │ 增加 ksbc table... │
│ 2132150 │ chenzhixu  │ xxx                │
└─────────┴────────────┴────────────────────┘
```

---

# 54. Changelist Detail

```text
Change 2132162

Description:
增加ksbc table级别的lua化

Files:

[x] TableDataManager.lua
[x] Config.xlsx
[x] TableData.json
```

显示：

```text
Action
Revision
Depot Path
File Type
Merge Tool
```

---

# 55. Target 页面

```text
Target Workspace

[ chenzhixu_C7_Weekly ▼ ]

Target Branch:
    //C7/Development/Weekly

Pending Changelist:
    [ Create New ]

Existing opened files:
    3

Warnings:
    1
```

---

# 56. Preview 页面

```text
Merge Preview

Source:
    Mainline
    CL 2132162

Target:
    Weekly

Target Pending:
    2150001

Files
────────────────────────────────────
File                Tool          Status
────────────────────────────────────
A.lua               P4Merge       Auto
B.xlsx              KeyExcel      Manual
C.json              P4Merge       Auto
D.uasset             Manual        Unsupported
────────────────────────────────────

[Cancel]                 [Start Merge]
```

---

# 57. Result 页面

```text
Merge Completed

Source:
    2132162

Target Pending:
    2150001

Result:
    8 files processed
    5 auto resolved
    2 manually resolved
    1 skipped

Target Workspace:
    chenzhixu_C7_Weekly

[Open Workspace]
[Open Pending Changelist]
```

这里的“Open Workspace / Open Pending Changelist”如果需要调用 P4V，应该是**辅助能力**，而不是 Merge 核心能力。

---

# 58. P4V Integration

虽然 Merge 核心流程不依赖 P4V，但可以提供：

```text
Open in P4V
```

例如：

```text
Open Workspace
Open Changelist
Open File
```

这部分必须通过独立的：

```text
P4VIntegrationService
```

实现。

不得让核心 Merge Service 依赖它。

---

# 59. 数据模型

核心：

```ts
interface MergeTask {
    id: string

    sourceWorkspace: P4Workspace
    targetWorkspace: P4Workspace

    sourceChanges: P4Changelist[]

    targetChange?: number

    sourceBranch?: Branch
    targetBranch?: Branch

    files: MergeFile[]

    status:
        | "created"
        | "preflight"
        | "syncing"
        | "integrating"
        | "resolving"
        | "completed"
        | "failed"
        | "cancelled"
}
```

---

# 60. MergeFile

```ts
interface MergeFile {
    sourcePath: string
    targetPath: string

    sourceRevision?: number
    targetRevision?: number
    baseRevision?: number

    action: string

    extension: string

    mergeTool?: string

    status:
        | "pending"
        | "syncing"
        | "integrated"
        | "auto-resolved"
        | "conflict"
        | "resolved"
        | "skipped"
        | "failed"
}
```

---

# 61. Backend Service 划分

推荐：

```text
src/main/services/
├── p4/
│   ├── P4Service.ts
│   ├── P4WorkspaceService.ts
│   ├── P4ChangelistService.ts
│   ├── P4BranchService.ts
│   ├── P4SyncService.ts
│   ├── P4IntegrateService.ts
│   └── P4ResolveService.ts
│
├── merge/
│   ├── MergeService.ts
│   ├── MergeToolService.ts
│   ├── MergeToolRegistry.ts
│   ├── MergeTransaction.ts
│   └── MergePreflightService.ts
│
├── redmine/
│   ├── RedmineService.ts
│   ├── RedmineHistoryParser.ts
│   └── RedmineRevisionResolver.ts
│
└── p4v/
    └── P4VIntegrationService.ts
```

---

# 62. Renderer Service

```text
src/renderer/
├── pages/
│   └── CrossBranchMerge/
│       ├── index.tsx
│       ├── SourceStep.tsx
│       ├── ChangelistStep.tsx
│       ├── TargetStep.tsx
│       ├── PreviewStep.tsx
│       ├── MergeStep.tsx
│       └── ResultStep.tsx
│
├── components/
│   ├── WorkspaceSelector.tsx
│   ├── ChangelistTable.tsx
│   ├── FileList.tsx
│   ├── MergePreview.tsx
│   └── MergeProgress.tsx
│
└── stores/
    └── mergeStore.ts
```

---

# 63. IPC API

Renderer 不应该直接理解 P4 CLI。

例如：

```ts
window.mergeApi.listWorkspaces()

window.mergeApi.listChangelists({
    workspace: "chenzhixu_C7_Mainline"
})

window.mergeApi.getChangelist({
    change: 2132162
})

window.mergeApi.previewMerge({
    sourceWorkspace: "...",
    sourceChange: 2132162,
    targetWorkspace: "..."
})

window.mergeApi.executeMerge({
    transactionId: "MERGE-20260911-00123"
})
```

---

# 64. Preview 必须是纯只读操作

`previewMerge()` 不应该修改：

* Workspace
* Pending Changelist
* Opened Files
* Local Files

Preview 只允许：

```text
P4 metadata 查询
Branch Mapping
File Mapping
Conflict Risk Analysis
Merge Tool Detection
```

真正修改从：

```text
executeMerge()
```

开始。

---

# 65. 日志与审计

每个 Merge Transaction 保存：

```text
transaction.json
```

包含：

```json
{
    "id": "MERGE-20260911-00123",
    "createdAt": "...",
    "user": "chenzhixu",
    "sourceWorkspace": "...",
    "sourceChanges": [2132162],
    "targetWorkspace": "...",
    "targetChange": 2150001,
    "files": [],
    "commands": [],
    "result": "success"
}
```

日志中禁止记录：

```text
P4 Password
Ticket
Access Token
Redmine Token
```

---

# 66. 第一阶段 MVP

第一阶段只实现：

```text
Workspace → Changelist → Target Workspace → Merge
```

功能：

* [x] Source Workspace
* [x] Target Workspace
* [x] 当前用户 Changelist
* [x] Changelist Detail
* [x] File List
* [x] Target 最小范围 Sync
* [x] Pending Changelist
* [x] p4 integrate
* [x] p4 resolve
* [x] P4Merge
* [x] KeyExcelMerge
* [x] Conflict 状态
* [x] Merge 日志
* [x] 不自动 Submit

暂不实现：

* Redmine
* 自动 Submit
* Stream 自动 Branch Mapping
* 多 Changelist 依赖分析
* 高级 Binary Merge

---

# 67. 第二阶段

第二阶段：

```text
Redmine Issue
    ↓
History Parser
    ↓
Revision
    ↓
P4 Changelist
    ↓
Source Workspace
    ↓
Target Workspace
    ↓
Merge
```

功能：

* [ ] Redmine Issue 查询
* [ ] History Parser
* [ ] Revision Parser
* [ ] P4 Revision 校验
* [ ] Source Workspace 自动识别
* [ ] 多 Revision
* [ ] Revision 依赖提示

---

# 68. 第三阶段

第三阶段：

* [ ] Stream 自动 Branch Mapping
* [ ] Merge History
* [ ] Merge Task Persistence
* [ ] Merge Retry
* [ ] Merge Transaction Recovery
* [ ] 更多内部 Merge Tool
* [ ] Binary Merge Strategy
* [ ] Submit Workflow
* [ ] Merge Result Report

---

# 69. AI 开发约束

后续使用 AI 开发本项目时必须遵守：

## 69.1 不允许绕过 Service 层

错误：

```ts
renderer → child_process.exec("p4 ...")
```

正确：

```text
renderer
    ↓ IPC
MergeService
    ↓
P4Service
    ↓
p4.exe
```

---

## 69.2 不允许把 P4 CLI 命令散落到业务代码

错误：

```ts
exec(`p4 sync ${path}`)
```

正确：

```ts
await p4Service.sync(paths)
```

---

## 69.3 不允许使用 shell 字符串拼接处理用户输入

必须使用：

```ts
spawn(executable, args)
```

而不是：

```ts
exec(`p4 ${userInput}`)
```

避免：

* 空格路径问题
* 引号问题
* shell injection
* Windows shell 差异

---

## 69.4 Merge Tool 参数必须结构化

不要：

```ts
exec(`${tool} ${args}`)
```

应该：

```ts
spawn(tool.executable, resolvedArgs)
```

---

## 69.5 所有 P4 操作必须可追踪

每一个：

```text
sync
integrate
resolve
add
edit
delete
```

都必须进入 Transaction Log。

---

# 70. 关键业务约束

必须始终遵守以下规则：

### Rule 1

**不允许默认全 Workspace Sync。**

只同步 Merge 所需文件或最小目录。

### Rule 2

**不允许自动覆盖 Target Workspace 用户修改。**

### Rule 3

**不允许自动 Submit。**

### Rule 4

**不允许依赖 P4V 完成核心 Merge。**

### Rule 5

**P4Merge / KeyExcelMerge 都属于可插拔 Merge Tool。**

### Rule 6

**Preview 不允许产生 Workspace 修改。**

### Rule 7

**Redmine Revision 必须通过 P4 二次校验。**

### Rule 8

**Source Changelist 是 Merge 的核心输入，而不是单纯的文件列表。**

### Rule 9

**必须保留 Perforce 的 move/delete/add 等 Action 语义。**

### Rule 10

**所有危险操作必须显式执行，不允许 Merge Service 隐式调用 revert / clean / submit。**

---

# 71. 推荐的最终业务模型

整个系统最终抽象成：

```text
                 ┌──────────────┐
                 │   Redmine    │
                 └──────┬───────┘
                        │
                        ▼
                 ┌──────────────┐
                 │ Revision     │
                 │ Resolver     │
                 └──────┬───────┘
                        │
                        ▼
┌──────────────┐   ┌──────────────┐
│ Source       │──▶│ P4 Changelist│
│ Workspace    │   └──────┬───────┘
└──────────────┘          │
                          ▼
                  ┌──────────────┐
                  │ Branch       │
                  │ Mapping      │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ Target       │
                  │ Workspace    │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ Preflight    │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ Minimal Sync │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ P4 Integrate │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ P4 Resolve   │
                  └──────┬───────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
         Auto Resolve          Merge Tool
                                    │
                    ┌───────────────┼──────────────┐
                    ▼               ▼              ▼
                 P4Merge       KeyExcelMerge     Manual
                    │               │              │
                    └───────────────┼──────────────┘
                                    ▼
                           Target Pending CL
                                    │
                                    ▼
                              User Review
                                    │
                                    ▼
                                  Submit
```

---

# 72. 最终验收标准

完成 MVP 后，以下场景必须能够完整运行：

## Case A：Lua

```text
Mainline Workspace
    ↓
CL 2132162
    ↓
TableDataManager.lua
    ↓
Weekly Workspace
    ↓
Minimal Sync
    ↓
p4 integrate
    ↓
p4 resolve
    ↓
P4Merge
    ↓
Target Pending CL
```

---

## Case B：Excel

```text
Mainline
    ↓
CL
    ↓
Config.xlsx
    ↓
Weekly
    ↓
Sync
    ↓
Integrate
    ↓
Conflict
    ↓
KeyExcelMerge
    ↓
Resolved
    ↓
Target Pending CL
```

---

## Case C：Redmine

```text
Redmine Issue
    ↓
History
    ↓
Revision 2132162
    ↓
p4 describe 2132162
    ↓
Source Client
    ↓
Source Workspace
    ↓
Target Workspace
    ↓
Preview
    ↓
Merge
    ↓
Pending CL
```

---

# 73. 当前实现优先级

开发顺序严格建议：

```text
P0
├── P4Service
├── WorkspaceService
├── ChangelistService
└── MergeTransaction

P1
├── Target Sync
├── Pending Changelist
├── Integrate
└── Resolve

P2
├── MergeToolRegistry
├── P4Merge
└── KeyExcelMerge

P3
├── Preview UI
├── Progress UI
└── Conflict UI

P4
├── Redmine
├── Revision Parser
└── Source Workspace Auto Resolve

P5
├── Stream Mapping
├── History
├── Recovery
└── Submit Workflow
```

核心原则：

> **先把 P4 CLI 层做正确，再做 Merge Service，最后做 UI。不要反过来从 UI 驱动 P4。**
