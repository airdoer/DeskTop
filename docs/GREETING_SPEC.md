# 用户问候与 Header Persona

> OpenSpec / Product Requirement
> Status: Draft
> Scope: Desktop Game Development Tool
> Priority: P2
> Target: Electron + React + Ant Design

---

## 1. 背景

游戏开发工具属于高频、长时间使用的生产力软件。

用户通常会持续登录工具，并在 Perforce、构建、部署、日志、玩家查询、数据编辑、Hotfix、服务器管理等多个功能之间切换。

当前 Header 右侧通常只包含：

```text
[通知] [设置] [用户名 ▼]
```

用户身份区域具有较强的功能属性，但缺少轻量的上下文信息。

本需求希望在用户身份区域左侧增加一个**低干扰的上下文问候语**，例如：

```text
上午好
中午好
下午好
晚上好
```

并允许未来根据应用上下文扩展为：

```text
下午好
辛苦了
欢迎回来
今天也辛苦了
```

该功能的目标不是聊天，也不是 AI 陪伴，而是提供轻量的人机交互反馈，同时增强工具的产品完成度。

---

# 2. 产品原则

## 2.1 问候语必须是辅助信息

问候语不能成为 Header 的主要视觉元素。

优先级：

```text
用户身份 > 核心操作 > 状态信息 > 问候语
```

因此：

```text
下午好，志旭        [Avatar] 志旭 ▼
```

优于：

```text
下午好！今天工作顺利吗？欢迎回来，志旭！     [Avatar]
```

---

## 2.2 不模拟人格

工具不应该表现出过度拟人的行为。

禁止：

```text
今天也要加油哦！
又是元气满满的一天！
辛苦啦，程序员！
你已经工作很久了，要注意休息哦！
```

这些内容容易让开发工具从 Productivity Tool 变成 Companion UI。

推荐：

```text
上午好
中午好
下午好
晚上好
```

在明确满足条件时再使用：

```text
辛苦了
欢迎回来
```

---

## 2.3 不打断用户

问候语属于 passive information。

不允许因为问候语产生：

* Toast
* Notification
* Dialog
* Animation
* 声音
* 页面跳转
* 强制用户操作

用户不需要注意到它，也不应该影响正常工作流。

---

# 3. UI 定位

## 3.1 Header 结构

推荐 Header 右侧结构：

```text
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   [Page / Workspace]                 下午好  [Avatar] 用户 ▼ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

完整结构：

```text
Header
├── Left
│   ├── Application / Project
│   └── Navigation context
│
├── Center
│   └── Optional global search / command
│
└── Right
    ├── Greeting
    ├── Notification
    ├── Settings
    └── User Persona
```

如果 Header 空间有限：

```text
下午好  [Avatar] 用户 ▼
```

如果空间足够：

```text
下午好，志旭  [Avatar] ▼
```

---

# 4. Greeting 类型

Greeting 不应该简单地由随机字符串组成。

应该建立一个明确的 Greeting Resolver。

```text
GreetingResolver
        │
        ├── Time Context
        │
        ├── User Context
        │
        ├── Session Context
        │
        └── Application Context
                │
                ▼
        Greeting Message
```

---

# 5. 第一阶段 Greeting 规则

MVP 只实现时间相关问候。

## 5.1 时间区间

默认使用本地时间。

| 时间            | Greeting |
| ------------- | -------- |
| 05:00 - 11:29 | 上午好      |
| 11:30 - 13:59 | 中午好      |
| 14:00 - 17:59 | 下午好      |
| 18:00 - 23:59 | 晚上好      |
| 00:00 - 04:59 | 夜深了      |

区间口径为「左闭右开」：起点（含）至下一起点（不含）。即 11:30:00 ≤ t < 14:00:00 为中午，
14:00 起进入下午；中午起点为 11:30（非整点），实现需支持分钟级边界。

其中：

```text
夜深了
```

属于状态提示，而不是鼓励用户继续工作。

因此不应该出现：

```text
夜深了，继续加油！
```

---

# 6. 第二阶段 Greeting

未来可以增加 Session Context。

例如：

### 首次启动

```text
欢迎回来
```

### 当天首次启动

```text
上午好
```

### 应用从后台恢复

```text
下午好
```

### 长时间运行后重新获得焦点

```text
欢迎回来
```

但这些状态必须经过明确的状态机判断，不允许随机出现。

---

# 7. 「辛苦了」规则

`辛苦了` 不应该仅根据时间判断。

例如：

```text
22:00 -> 辛苦了
```

这是错误的。

因为：

```text
时间 ≠ 工作状态
```

用户可能：

* 晚上才开始工作
* 正在值班
* 正在玩游戏
* 工具只是开着
* 正在挂机
* 当前没有进行任何任务

因此 `辛苦了` 必须依赖真实的 Session / Activity Context。

推荐未来使用：

```text
SessionContext
├── sessionStartTime
├── activeDuration
├── lastActiveTime
├── taskCount
├── completedTaskCount
└── currentTask
```

例如：

```text
activeDuration > 4h
AND
current session active
AND
no greeting shown recently
```

才允许产生：

```text
辛苦了
```

MVP 阶段暂时不要实现该逻辑。

---

# 8. Greeting Resolver

建议设计独立模块：

```text
src/
└── features/
    └── greeting/
        ├── GreetingResolver.ts
        ├── greeting.types.ts
        ├── greeting.config.ts
        └── Greeting.tsx
```

---

## 8.1 Type Definition

```ts
export type GreetingType =
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'lateNight'
  | 'welcomeBack'
  | 'hardWork';

export interface GreetingContext {
  now: Date;
  isFirstLaunchToday: boolean;
  isReturningFromBackground: boolean;
  sessionDuration?: number;
  activeDuration?: number;
}
```

---

# 9. Resolver API

推荐：

```ts
export function resolveGreeting(
  context: GreetingContext
): GreetingResult
```

返回：

```ts
export interface GreetingResult {
  type: GreetingType;
  text: string;
  priority: number;
}
```

例如：

```ts
resolveGreeting({
  now: new Date(),
  isFirstLaunchToday: false,
  isReturningFromBackground: false,
});
```

返回：

```ts
{
  type: 'afternoon',
  text: '下午好',
  priority: 10
}
```

---

# 10. 优先级

未来 Greeting 类型增加以后，不能通过大量 `if / else` 随意覆盖。

统一使用 priority：

```text
welcomeBack   100
hardWork       80
morning        10
noon           10
afternoon      10
evening        10
lateNight      10
```

Resolver：

```text
收集候选 Greeting
        │
        ▼
过滤不满足条件的 Greeting
        │
        ▼
按照 priority 排序
        │
        ▼
选择最高优先级
        │
        ▼
返回 GreetingResult
```

这样未来增加：

```text
BuildCompleted
DeployCompleted
HotfixCompleted
```

不会破坏现有时间 Greeting。

---

# 11. 文案配置

Greeting 文案不得硬编码在 React Component 中。

推荐：

```ts
export const greetingMessages = {
  morning: [
    '上午好',
  ],

  noon: [
    '中午好',
  ],

  afternoon: [
    '下午好',
  ],

  evening: [
    '晚上好',
  ],

  lateNight: [
    '夜深了',
  ],

  welcomeBack: [
    '欢迎回来',
  ],

  hardWork: [
    '辛苦了',
  ],
};
```

MVP 不需要随机文案。

未来如果需要扩展：

```ts
afternoon: [
  '下午好',
  '下午好，开始工作吧',
]
```

可以在 Resolver 层决定。

---

# 12. UI Component

建议组件：

```tsx
<Greeting
  message={greeting.text}
/>
```

而不是：

```tsx
<HeaderGreeting />
```

因为 Greeting 本质上是一个通用 UI primitive。

---

## 12.1 推荐视觉结构

```text
下午好        [Avatar] 志旭 ▼
```

CSS：

```text
Greeting
├── font-size: 13px
├── font-weight: 400
├── opacity: 0.75
└── white-space: nowrap
```

不要使用：

```text
font-size: 16px+
font-weight: 600+
large colorful icon
animated background
```

---

# 13. 与用户 Persona 的关系

推荐最终结构：

```text
┌──────────────────────────────────────────────┐
│                         下午好   ◉ 志旭  ▼   │
└──────────────────────────────────────────────┘
```

点击：

```text
◉ 志旭 ▼
```

打开 User Menu：

```text
┌────────────────────────────┐
│ ◉ 志旭                     │
│   Game Server Developer    │
├────────────────────────────┤
│ Workspace                  │
│ Preferences                │
│ Keyboard Shortcuts         │
├────────────────────────────┤
│ Sign out                   │
└────────────────────────────┘
```

Greeting 本身不应该是交互入口。

---

# 14. 时间计算

必须使用用户当前系统时间：

```ts
const now = new Date();
const hour = now.getHours();
```

禁止：

```ts
Date.UTC(...)
```

除非产品明确要求使用服务器时区。

---

## 14.1 时区原则

MVP：

```text
使用操作系统本地时间
```

未来如果工具支持：

```text
Server Time
Local Time
Workspace Timezone
```

则 Greeting 必须明确指定：

```ts
GreetingTimeZone =
  | 'system'
  | 'workspace'
  | 'server';
```

默认：

```text
system
```

---

# 15. Electron 注意事项

Greeting 属于 Renderer UI。

不要让 Main Process 负责决定：

```text
上午好 / 下午好
```

推荐：

```text
Electron Main
    │
    └── Window lifecycle

Renderer
    │
    ├── Header
    ├── User Persona
    └── GreetingResolver
```

原因：

Greeting 属于 UI context，并不需要 IPC。

只有当未来需要读取：

```text
用户账号
工作时长
服务器状态
Workspace
```

等外部数据时，再通过 IPC / API 获取 Context。

---

# 16. 时间变化

应用可能长时间运行。

例如：

```text
11:29 启动
11:30
```

不能因为组件只在 mount 时执行一次而继续显示：

```text
上午好
```

因此 Greeting 应该监听时间边界。

推荐：

```text
Application Start
      │
      ▼
Calculate next boundary
      │
      ▼
setTimeout()
      │
      ▼
Recalculate Greeting
```

例如：

```text
11:29:50
    │
    └── 10 秒后重新计算
            │
            ▼
        中午好
```

不要使用：

```ts
setInterval(() => {
  setGreeting(...)
}, 1000);
```

没有必要每秒计算。

---

# 17. 页面切换

页面切换不应该重新触发 Greeting。

错误：

```text
打开 Dashboard
→ 下午好

打开 P4
→ 下午好

打开 Build
→ 下午好

打开 Player
→ 下午好
```

正确：

```text
登录 / 应用启动
        │
        ▼
确定 Greeting
        │
        ▼
整个 Session 保持
```

只有时间跨越 Greeting Boundary 时才更新。

---

# 18. 动画

MVP 默认：

```text
无动画
```

如果设计系统要求增加状态变化动画：

```text
opacity 0
    ↓
opacity 1
```

动画时间建议：

```text
100ms ~ 180ms
```

禁止：

```text
bounce
scale
shake
particle
confetti
```

生产力工具不需要这些反馈。

---

# 19. Accessibility

Greeting 属于辅助文本。

要求：

```html
<span class="greeting">
  下午好
</span>
```

不应该：

```html
<button>
  下午好
</button>
```

不应该获得 keyboard focus。

如果使用屏幕阅读器，Greeting 不应高频触发 live announcement。

禁止：

```html
aria-live="assertive"
```

一般不需要：

```html
aria-live
```

因为它不是重要状态变化。

---

# 20. Responsive / Window Resize

Electron 窗口可能被缩小。

Header 应该按照以下优先级隐藏：

```text
Greeting
    ↓
Notification text
    ↓
Secondary actions
```

而不能隐藏：

```text
User Avatar
User Menu
Core Navigation
```

例如：

### 正常

```text
下午好       [Bell] [Settings] [Avatar] 志旭 ▼
```

### 中等宽度

```text
下午好       [Bell] [Avatar] 志旭 ▼
```

### 小宽度

```text
[Avatar] 志旭 ▼
```

Greeting 是可牺牲信息。

---

# 21. 配置项

建议预留：

```ts
interface GreetingSettings {
  enabled: boolean;
  showUserName: boolean;
  useLocalTime: boolean;
}
```

MVP：

```ts
{
  enabled: true,
  showUserName: false,
  useLocalTime: true,
}
```

暂时不提供复杂的 Settings UI。

配置接口存在即可。

---

# 22. 国际化

不要直接：

```ts
if (locale === 'zh-CN') {
  return '下午好';
}
```

应该：

```ts
i18n.t(`greeting.${type}`)
```

例如：

```json
{
  "greeting": {
    "morning": "上午好",
    "noon": "中午好",
    "afternoon": "下午好",
    "evening": "晚上好",
    "lateNight": "夜深了",
    "welcomeBack": "欢迎回来",
    "hardWork": "辛苦了"
  }
}
```

英文：

```json
{
  "greeting": {
    "morning": "Good morning",
    "noon": "Good afternoon",
    "afternoon": "Good afternoon",
    "evening": "Good evening",
    "lateNight": "It's getting late",
    "welcomeBack": "Welcome back",
    "hardWork": "Nice work"
  }
}
```

> 英文没有与「中午」对应的独立问候语，`noon` 沿用 `Good afternoon`，不是重复定义的笔误。

---

# 23. 测试要求

必须覆盖时间边界。

```text
04:59 → 夜深了
05:00 → 上午好

11:29 → 上午好
11:30 → 中午好

13:59 → 中午好
14:00 → 下午好

17:59 → 下午好
18:00 → 晚上好

23:59 → 晚上好
00:00 → 夜深了
```

测试不应该依赖真实系统时间。

推荐：

```ts
resolveGreeting({
  now: new Date('2026-09-11T12:00:00'),
  ...
});
```

---

# 24. Acceptance Criteria

## AC-01 时间 Greeting

Given:

```text
用户已登录
```

When:

```text
当前时间为 11:30 ~ 13:59（中午区间）
```

Then:

```text
Header 显示「中午好」
```

> 其余区间同理由 §5.1 的时间表决定（05:00–11:29 上午好 / 14:00–17:59 下午好 /
> 18:00–23:59 晚上好 / 00:00–04:59 夜深了）。

---

## AC-02 不干扰核心 UI

Given：

```text
用户正在操作工具
```

Then：

```text
Greeting 不产生弹窗
Greeting 不产生 Toast
Greeting 不抢夺焦点
Greeting 不影响页面操作
```

---

## AC-03 时间跨越

Given：

```text
用户 11:29 打开工具
```

When：

```text
系统时间进入 11:30
```

Then：

```text
Greeting 自动从「上午好」更新为「中午好」
```

---

## AC-04 页面切换

Given：

```text
Greeting = 下午好
```

When：

```text
用户切换 Dashboard / P4 / Build / Player 等页面
```

Then：

```text
Greeting 保持一致
```

---

## AC-05 Window Resize

Given：

```text
窗口宽度不足
```

Then：

```text
Greeting 可以隐藏
User Persona 必须保持可用
```

---

## AC-06 Accessibility

Given：

```text
用户使用键盘导航
```

Then：

```text
Greeting 不进入 Tab 顺序
```

---

# 25. 非目标

本需求明确不实现：

* AI 聊天
* 情绪识别
* 用户心理状态判断
* 用户疲劳检测
* 工作时长强提醒
* 强制休息
* Greeting Notification
* Greeting Toast
* Greeting 动画系统
* 根据用户行为随机生成文案
* 根据用户提交代码内容评价用户
* 根据用户工作时间推测用户生活状态

尤其不要实现：

```text
晚上 11 点
→ 「你还在加班，辛苦了」
```

这属于未经授权的行为推断。

---

# 26. 后续扩展

未来可以将 Greeting 从简单的：

```text
Time → Text
```

扩展成：

```text
Context
   │
   ├── Time
   ├── Session
   ├── Workspace
   ├── Recent Activity
   ├── Build Status
   ├── P4 Status
   └── Deployment Status
            │
            ▼
      Greeting Resolver
            │
            ▼
        UI Greeting
```

例如：

```text
下午好
```

或者：

```text
下午好 · Preonline
```

或者在明确的任务完成后：

```text
构建完成
```

但这属于后续的 **Contextual Header Status**，不要在 MVP 中与 Greeting 混在一起。

---

# 27. 推荐最终设计

第一版只做：

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Game Tools                                  下午好  ◉ 志旭 ▼│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

规则：

```text
05:00–11:29   上午好
11:30–13:59   中午好
14:00–17:59   下午好
18:00–23:59   晚上好
00:00–04:59   夜深了
```

技术：

```text
React Component
      │
      ▼
GreetingResolver
      │
      ▼
Local System Time
      │
      ▼
i18n
```

暂时不要加入：

```text
AI
随机文案
工作时长分析
用户行为分析
复杂动画
通知
弹窗
```

这会让一个简单的 Header enhancement 迅速演变成没有实际价值的“智能助手”。

---

# 28. 开发任务拆分

> 实现状态（v1，时间问候 MVP）：Task 1–5 已完成并落地到
> `src/features/greeting/`（`greeting.types.ts` / `greeting.config.ts` / `GreetingResolver.ts` / `Greeting.tsx`）
> 与 `src/shell/TitleBar.tsx`，边界用例见 `test/greeting.test.ts`。
> 与本文档的三处偏差见下方 Task 2 / Task 3 的括注。
>
> 区间调整记录：v1.1 起中午独立为 11:30–13:59（原 12:00 起为下午）。
> 时间边界改为分钟级，实现见 `TIME_GREETING_RANGES` 的 `startMinute` 与
> `TIME_BOUNDARY_MINUTES`（新增/调整区间只需改 `TIME_GREETING_RANGES`）。

### Task 1 — Greeting Domain

* [x] 创建 `GreetingType`
* [x] 创建 `GreetingContext`
* [x] 创建 `GreetingResult`
* [x] 实现 `resolveGreeting()`
* [x] 实现时间区间判断
* [x] 添加边界测试

### Task 2 — i18n

* [x] 增加中文 Greeting
* [x] 增加英文 Greeting
* [x] Greeting 不允许在 Component 内硬编码

> 偏差：项目当前未引入 i18n 库（`package.json` 无 i18next / react-i18next），且
> `UI_DESIGN_SYSTEM.md` §30 禁止自行引入新依赖。因此文案收敛在 `greeting.config.ts` 的
> `greetingMessages`（按 locale 分组，形状等价于 `greeting.<type>`），
> 接入 i18n 后只需替换 `resolveGreetingText` 内部实现。

### Task 3 — Header UI

* [x] 创建 `Greeting` Component
* [x] 集成 User Persona
* [x] 控制 typography
* [x] 控制 spacing
* [x] 支持窗口缩小时隐藏

> 偏差一：本项目的「Header」对应 `src/shell/TitleBar.tsx`（36px 自定义标题栏），
> 问候语置于 User Persona 左侧、随拖拽区一起呈现。
> 偏差二：响应式阈值用 1024px 而非默认 `md`(768px) —— 窗口 `minWidth: 960`，
> 768px 断点永不生效。

### Task 4 — Runtime

* [x] 应用启动计算 Greeting
* [x] 计算下一时间边界
* [x] 使用 `setTimeout` 更新
* [x] 页面切换不重新触发
* [x] 窗口 resize 不重新触发

### Task 5 — Accessibility

* [x] Greeting 不进入 Tab
* [x] 不使用 assertive aria-live
* [x] 不抢占 focus
* [x] 窄窗口下 Persona 保持可用

### Task 6 — Acceptance Test

* [x] 04:59
* [x] 05:00
* [x] 11:29
* [x] 11:30
* [x] 13:59
* [x] 14:00
* [x] 17:59
* [x] 18:00
* [x] 23:59
* [x] 00:00
* [ ] 页面切换（需 `pnpm dev` 手动确认）
* [ ] Window Resize（需 `pnpm dev` 手动确认）
* [ ] 应用长时间运行（需跨时间边界实机确认）
