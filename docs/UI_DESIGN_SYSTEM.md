# Desktop UI Design System

> 本文档是本项目所有 UI、交互和桌面应用界面开发的强制设计规范。
>
> 所有开发人员和 AI 在新增、修改或重构 UI 时，必须遵循本文档。
>
> 如果业务需求与本文档冲突，应优先保持整体设计系统一致性，并明确说明冲突点。

---

# 1. Design Goals

## 1.1 Application Type

本项目是：

```text
Windows Desktop Application
Electron + React
Ant Design
```

应用定位：

```text
Desktop Productivity Tool
Developer Tool
Game Operations Tool
Internal Tool Platform
```

不是：

```text
Marketing Website
Mobile Application
Landing Page
Social Application
```

---

## 1.2 Core Design Principles

所有 UI 必须遵循以下原则：

### Professional

界面应当专业、稳定、克制。

避免：

* 过度装饰
* 过度渐变
* 大面积玻璃效果
* 大面积阴影
* 过度圆角
* 无意义动画

---

### Efficient

软件优先考虑：

```text
Information Density
Operational Efficiency
Keyboard Efficiency
Fast Navigation
```

而不是：

```text
Large Empty Space
Visual Decoration
Marketing Style
```

---

### Low Visual Noise

界面应该减少：

* 不必要的颜色
* 不必要的 Border
* 不必要的 Shadow
* 不必要的 Icon
* 不必要的 Card

视觉层级应该通过：

```text
Spacing
Typography
Background
Subtle Border
```

建立。

---

### Consistency

所有页面必须使用统一：

```text
Spacing
Typography
Color
Radius
Icon
Interaction
Feedback
```

禁止同一应用中出现多个不同的设计语言。

---

# 2. Design Language

本项目采用：

```text
Windows Fluent Design Principles
+
Desktop Productivity Software Patterns
+
Ant Design Implementation
```

设计参考：

```text
Microsoft Fluent 2
VS Code
Postman
Raycast
Linear
uTools
```

注意：

这些软件仅作为：

```text
Interaction Pattern Reference
Information Architecture Reference
Desktop Application Reference
```

禁止直接复制某个产品的完整视觉风格。

---

# 3. Application Architecture

UI 必须分为以下层级：

```text
┌─────────────────────────────┐
│ Desktop Application Shell   │
│                             │
│ TitleBar                    │
│ Sidebar                     │
│ Command Bar                 │
│ Status Bar                  │
│ Notification Center         │
├─────────────────────────────┤
│ Page Layout                 │
│                             │
│ Page Header                 │
│ Toolbar                     │
│ Content Area                │
├─────────────────────────────┤
│ UI Components               │
│                             │
│ Button                      │
│ Input                       │
│ Table                       │
│ Dialog                      │
├─────────────────────────────┤
│ Business Features           │
│                             │
│ Player Search               │
│ Data Tools                  │
│ GM Tools                    │
└─────────────────────────────┘
```

---

# 4. Application Shell

Application Shell 是整个应用的基础框架。

业务页面不得直接实现：

* TitleBar
* Window Controls
* Sidebar
* Global Notification
* Global Search
* Command Palette

这些必须由 Application Shell 统一提供。

---

## 4.1 Recommended Structure

```text
renderer/

├── app/
│
├── shell/
│   ├── AppShell.tsx
│   ├── AppTitleBar.tsx
│   ├── Sidebar.tsx
│   ├── TopBar.tsx
│   ├── StatusBar.tsx
│   └── GlobalOverlay.tsx
│
├── components/
│
├── pages/
│
├── features/
│
└── services/
```

---

# 5. Spacing System

基础单位：

```text
4px
```

所有间距必须优先使用以下 Token：

| Token | Value |
| ----- | ----: |
| xs    |   4px |
| sm    |   8px |
| md    |  12px |
| lg    |  16px |
| xl    |  24px |
| xxl   |  32px |

---

## 5.1 Rules

允许：

```css
padding: 8px;
gap: 12px;
margin-bottom: 16px;
```

避免：

```css
padding: 11px;
margin: 13px;
gap: 17px;
```

除非存在明确的布局需求，否则禁止随意创建新的间距值。

---

# 6. Border Radius

桌面应用使用较小的圆角。

| Token  | Value |
| ------ | ----: |
| Small  |   4px |
| Medium |   6px |
| Large  |   8px |

禁止：

```text
16px
20px
24px
```

除非：

* 特殊浮层
* Avatar
* Pill Tag
* 明确的圆形组件

默认原则：

```text
Desktop UI != Mobile UI
```

禁止将页面设计成大圆角卡片堆叠风格。

---

# 7. Information Density

本项目默认使用：

```text
Compact Desktop Density
```

推荐：

| Component      |        Size |
| -------------- | ----------: |
| Toolbar Height | 40px - 48px |
| Sidebar Item   | 32px - 40px |
| Table Row      | 32px - 40px |
| Input Height   | 32px - 40px |
| Button Height  | 28px - 36px |

避免：

```text
过大的按钮
过大的输入框
过大的卡片
大量垂直空白
```

页面应优先考虑：

```text
Information Density
```

而不是：

```text
Landing Page Layout
```

---

# 8. Layout Principles

页面推荐结构：

```text
┌──────────────────────────────────────┐
│ Page Header                          │
│ Title                      Actions   │
├──────────────────────────────────────┤
│ Toolbar                              │
│ Search / Filter / Actions            │
├──────────────────────────────────────┤
│                                      │
│ Main Content                         │
│                                      │
│ Table / Tree / Panel / Editor        │
│                                      │
└──────────────────────────────────────┘
```

---

## 8.1 Page Header

Page Header 包含：

```text
Title
Optional Description
Primary Actions
```

推荐：

```text
玩家查询                         [刷新]

查询和管理玩家信息
```

禁止：

```text
                玩家查询

         用于查询玩家信息的功能

                  [开始]
```

不要将工具型桌面页面设计成 Landing Page。

---

# 9. Sidebar

Sidebar 用于：

```text
Primary Navigation
```

推荐：

```text
首页

────────────

玩家工具
数据工具
GM 工具

────────────

自动化

────────────

设置
```

规则：

* Sidebar 保持稳定
* 不随页面频繁变化
* 一级导航不超过必要数量
* 复杂功能通过二级页面或页面内部导航处理

---

# 10. Command Bar

Command Bar 用于：

```text
Page Level Actions
```

例如：

```text
[刷新]
[新增]
[导入]
[导出]
[更多 ▾]
```

规则：

### Primary Action

最多：

```text
1 - 2 个
```

### Secondary Action

放入：

```text
More Menu
```

禁止：

```text
顶部同时出现 10 个 Button
```

---

# 11. Feedback System

所有反馈必须区分类型。

禁止所有情况都使用：

```text
message.success()
message.error()
```

---

## 11.1 Toast

适用于：

```text
短暂
非阻塞
无需长期保存
```

例如：

```text
复制成功
保存成功
操作完成
```

特点：

```text
自动消失
不阻塞操作
```

---

## 11.2 Message Bar

适用于：

```text
页面级状态
重要提醒
需要持续显示
```

例如：

```text
⚠ 当前服务器连接异常

[重新连接]
```

Message Bar 不应自动消失。

---

## 11.3 Dialog

适用于：

```text
用户必须做决定
高风险操作
不可逆操作
```

例如：

```text
确定删除？

删除后无法恢复。

[取消] [删除]
```

禁止：

```text
普通提示
普通成功信息
简单确认
```

使用 Dialog。

---

## 11.4 Inline Validation

错误应该尽可能靠近发生位置。

推荐：

```text
Player ID

[____________]

请输入有效的 Player ID
```

避免：

```text
提交

↓

❌ 参数错误
```

---

# 12. Notification Center

应用提供统一 Notification Center。

通知类型：

```text
Success
Warning
Error
Info
```

结构：

```text
🔔 Notifications

────────────────

⚠ 数据同步失败
2分钟前

✓ 玩家数据导入完成
10分钟前

ℹ 服务连接成功
30分钟前
```

---

## 12.1 Notification Service

业务代码禁止直接控制：

```text
Toast
Windows Notification
Notification Center
```

统一使用：

```ts
notify({
  type: 'success',
  title: '导入完成',
  message: '成功导入 1248 条数据',
})
```

由 Notification Service 决定：

```text
Toast
Notification Center
Windows Notification
```

的展示方式。

---

# 13. Dialog Rules

Dialog 必须：

```text
Title
Clear Description
Explicit Actions
```

例如：

```text
删除玩家数据？

该操作无法恢复。

[取消] [删除]
```

规则：

* Cancel 在左侧
* Destructive Action 在右侧
* Destructive Action 使用危险颜色
* Button 文案必须明确

禁止：

```text
[确定]
[取消]
```

用于复杂操作。

应该：

```text
[取消]
[删除]
```

---

# 14. Icon System

整个项目只能选择一个主要 Icon System。

推荐：

```text
Fluent System Icons
```

或者：

```text
Ant Design Icons
```

禁止混合：

```text
Fluent Icons
+
Ant Icons
+
Lucide
+
Emoji
+
Material Icons
```

除非明确有兼容需求。

---

# 15. Color Usage

颜色用于表达：

```text
Hierarchy
Status
Action
Semantic Meaning
```

不是用于装饰。

默认：

```text
Primary
Neutral
Success
Warning
Error
Info
```

禁止：

```text
每个 Card 一个颜色
大面积 Gradient
彩色 Background
无意义的颜色强调
```

---

# 16. Shadow

Shadow 仅用于：

```text
Popover
Dropdown
Context Menu
Dialog
Floating Panel
```

普通页面：

```text
不使用明显 Shadow
```

普通 Card：

```text
优先使用：

Background
Border
Spacing
```

区分层级。

---

# 17. Card Rules

禁止：

```text
所有内容都放在 Card 中
```

Card 应该用于：

```text
独立的信息区域
独立的功能模块
需要视觉分组的区域
```

不适合：

```text
Table 外面套 Card
Card 里面再套 Card
Card 内再套 Card
```

避免：

```text
Card Pyramid
```

---

# 18. Table Rules

Table 是桌面工具的重要组件。

原则：

```text
Compact
Readable
Sortable
Filterable
```

推荐：

```text
Search
Filter
Sort
Column Resize
Column Visibility
Pagination
```

复杂数据：

```text
Table 优先
```

不要为了“现代感”强行改成：

```text
Card List
```

---

# 19. Form Rules

Form 应该：

```text
Label Clear
Layout Compact
Validation Inline
```

推荐：

```text
Player ID
[______________]

Server
[Select Server ▼]

Status
[Online ▼]

                    [Cancel] [Search]
```

禁止：

```text
过大的 Label
过大的 Input
大量垂直空白
```

---

# 20. Loading State

Loading 分为：

```text
Page Loading
Component Loading
Button Loading
```

禁止整个页面任何操作都显示：

```text
Full Screen Spinner
```

推荐：

```text
局部 Loading
```

例如：

```text
Button
↓
Loading Button
```

而不是：

```text
整个页面不可操作
```

---

# 21. Empty State

Empty State 应该：

```text
Clear
Short
Actionable
```

例如：

```text
暂无玩家数据

[刷新]
```

避免：

```text
大型插画

暂无数据哦～
快去创建你的第一个数据吧！
```

除非产品明确需要用户引导。

---

# 22. Keyboard Interaction

桌面应用必须考虑：

```text
Keyboard First
```

重要功能应该考虑：

```text
Ctrl + K
Global Search / Command Palette

Esc
Close Overlay

Enter
Confirm / Submit

Ctrl + Enter
Optional Primary Action
```

复杂工具必须提供：

```text
Keyboard Shortcut
```

而不是完全依赖鼠标。

---

# 23. Command Palette

应用应预留：

```text
Command Palette
```

结构：

```text
Search Commands...

────────────────

玩家查询
打开数据工具
打开 GM 工具
刷新当前页面
打开设置
```

用途：

```text
快速导航
执行命令
打开工具
搜索功能
```

Command Palette 不应该直接耦合业务页面。

应该通过：

```text
Command Registry
```

统一注册。

---

# 24. Global Search

Global Search 和 Command Palette 可以共享入口。

例如：

```text
Ctrl + K
```

但必须区分：

```text
Search Data
```

和：

```text
Execute Command
```

不要把所有东西都混成一个搜索框。

---

# 25. Desktop Native Features

以下功能属于 Desktop Layer：

```text
Window Management
Tray
Native Notification
Global Shortcut
Application Menu
Context Menu
```

业务代码禁止直接调用 Electron API。

必须通过：

```text
Desktop Service
```

或者：

```text
IPC Service
```

进行调用。

---

# 26. Window Architecture

推荐：

```text
main/

├── window/
│   ├── WindowManager.ts
│   └── WindowState.ts
│
├── tray/
│   └── TrayManager.ts
│
├── notification/
│   └── NotificationManager.ts
│
├── menu/
│   └── ApplicationMenu.ts
│
└── shortcut/
    └── ShortcutManager.ts
```

Renderer 不应该直接：

```ts
new BrowserWindow()
```

Renderer 不应该直接：

```ts
new Notification()
```

所有 Desktop API 必须通过：

```text
Preload
↓
IPC
↓
Main Process
```

访问。

---

# 27. Component Architecture

推荐：

```text
components/

├── ui/
│   ├── AppButton
│   ├── AppInput
│   ├── AppSelect
│   └── AppTooltip
│
├── feedback/
│   ├── Toast
│   ├── MessageBar
│   ├── NotificationCenter
│   └── InlineError
│
├── navigation/
│   ├── Sidebar
│   ├── Breadcrumb
│   ├── Tabs
│   └── CommandBar
│
├── overlay/
│   ├── Dialog
│   ├── Drawer
│   ├── Popover
│   └── ContextMenu
│
└── layout/
    ├── Page
    ├── PageHeader
    ├── Panel
    └── SplitView
```

---

# 28. Business Component Rules

业务组件：

```text
features/

├── player/
│
├── data/
│
├── gm/
│
└── automation/
```

业务组件不应该：

```text
控制 TitleBar
控制 Sidebar
控制 Tray
控制 Window
直接发送系统 Notification
```

业务组件只负责：

```text
Business Logic
Business UI
Business State
```

---

# 29. Ant Design Rules

Ant Design 是：

```text
Implementation Library
```

不是：

```text
Design System
```

禁止直接依赖 Ant Design 默认视觉风格。

必须：

```text
通过 Theme Token
+
Project Component Wrapper
```

统一风格。

推荐：

```tsx
<AppButton />
<AppInput />
<AppDialog />
<AppMessageBar />
```

而不是业务代码到处：

```tsx
<Button />
<Input />
<Modal />
```

---

# 30. AI Development Rules

AI 在开发 UI 前必须：

1. 阅读本设计规范
2. 判断当前需求属于：

   * Application Shell
   * Page Layout
   * UI Component
   * Business Feature
3. 优先复用已有组件
4. 不重复创建已有组件
5. 不随意修改 Design Token
6. 不引入新的 UI Library
7. 不创造新的视觉风格

---

## 30.1 AI 禁止行为

AI 禁止：

```text
自行设计新的 Design System
自行更换 Icon Library
自行修改全局 Spacing
自行修改 Radius
随意增加 Gradient
随意增加 Glassmorphism
将所有内容 Card 化
为了“现代感”增加大量动画
```

---

# 31. UI Implementation Checklist

开发新页面前：

```text
□ 是否已经存在对应组件？

□ 是否符合 Application Shell？

□ 是否符合 Spacing Token？

□ 是否符合 Radius Token？

□ 是否保持 Compact Density？

□ 是否存在过度 Card？

□ 是否存在无意义 Shadow？

□ 是否存在无意义颜色？

□ 是否符合 Feedback System？

□ 是否支持 Keyboard Interaction？
```

---

# 32. Final Principle

本项目 UI 优先级：

```text
Consistency
↓
Efficiency
↓
Information Density
↓
Clarity
↓
Visual Aesthetics
```

不是：

```text
漂亮
↓
其他
```

现代桌面软件的核心不是：

```text
Gradient
Glass
Large Radius
Large Cards
```

而是：

```text
Clear Information Architecture

Consistent Interaction

Predictable Behavior

High Information Density

Keyboard Efficiency

Low Visual Noise
```

---

# AI Instruction

当 AI 开始开发 UI 时，必须默认遵循：

> 本项目是 Windows Desktop Productivity Application，而不是 Marketing Website 或 Mobile Application。
>
> 所有 UI 必须优先考虑 Information Density、Operational Efficiency、Consistency 和 Keyboard Interaction。
>
> 严格遵循 UI_DESIGN_SYSTEM.md。
>
> 禁止自行创造新的设计语言。
>
> 禁止为了“现代感”加入大圆角、大量渐变、Glassmorphism、大量 Card 和无意义动画。
>
> 优先复用项目已有 Component。
>
> 新增组件前必须检查是否已有类似组件。
>
> 如果设计规范与当前需求冲突，必须明确指出冲突，而不是静默违反规范。
