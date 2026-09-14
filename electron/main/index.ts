import { app, BrowserWindow, shell, ipcMain, Menu } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { update } from './update'
import { registerIpcHandlers } from './ipc'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (process.platform === 'win32' && os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

/*
 * 便携版（electron-builder target: portable）支持.
 * 便携 exe 是自解压包，运行时解压到临时目录执行，仅通过 PORTABLE_EXECUTABLE_DIR
 * 暴露 exe 所在目录。默认 userData 仍在 %APPDATA%，配置不会跟着 exe 走；
 * 这里把 userData 重定向到 exe 同级的 "Portable Settings" 目录，
 * 使「常用目录配置」等数据随 exe 一起携带（U 盘/多机复制即可用）。
 */
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
if (portableDir) {
  app.setPath('userData', path.join(portableDir, 'Portable Settings'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

/**
 * 窗口控制按钮区高度契约（px）.
 * 主进程去掉 titleBarOverlay 后窗口控制改为渲染层自定义，主进程不再直接使用此值；
 * 渲染层标题栏高度必须与此保持一致，见 src/shell/TitleBar.tsx 的 TITLE_BAR_HEIGHT。
 */
const TITLE_BAR_HEIGHT = 36
// 契约常量保留导出，便于主进程未来若重新需要时直接引用
export { TITLE_BAR_HEIGHT }

let win: BrowserWindow | null = null
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    title: 'C7 DeskTop',
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
    /*
     * 无标题栏：内容区直接顶到窗口顶部（full size content window）。
     * 不使用 titleBarOverlay —— 改为在渲染层完全自定义窗口控制按钮
     * （最小化 / 最大化 / 关闭）+ 登录用户按钮，置于右上角，视觉风格统一。
     * 渲染层顶部拖拽区高度见 src/shell/AppShell.tsx 的 TITLE_BAR_HEIGHT。
     */
    titleBarStyle: 'hidden',
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    /*
     * 开发态打开 DevTools，**显式指定 docked（mode: 'right'）**。
     *
     * 不能省掉 mode 依赖默认值：DevTools 的停靠状态由 Chromium 持久化在 profile 里，
     * 一旦被拖成独立窗口，之后每次都按独立窗口打开。而独立的 DevTools 是主窗口的
     * owned window（Win32 概念），会带来两个后果：
     *   ① 覆盖 owner 的 always-on-top —— 「窗口置顶」点了没效果，主窗口仍被其他程序挡住
     *      （主窗口 isAlwaysOnTop() 会被打回 false）；
     *   ② 同处置顶层时，owned window 永远显示在 owner 之上 —— 主窗口无法压住它。
     * 显式传 mode 可覆盖这份持久化状态，让开发态的置顶行为与打包态一致
     * （打包态不打开 DevTools，天然没有这个问题）。
     */
    win.webContents.openDevTools({ mode: 'right' })
  } else {
    win.loadFile(indexHtml)
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  /*
   * 通知渲染层窗口最大化状态变化，用于自定义「最大化/还原」按钮图标切换.
   * Electron 原生 titleBarOverlay 关闭后，最大化状态只能由主进程主动推送。
   */
  const notifyMaximized = () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximized-changed', true)
  }
  const notifyUnmaximized = () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximized-changed', false)
  }
  win.on('maximize', notifyMaximized)
  win.on('unmaximize', notifyUnmaximized)
  win.on('restore', notifyMaximized)
  win.on('minimize', notifyUnmaximized)

  // Auto update
  update(win)
}

app.whenReady().then(() => {
  // Remove the default application menu bar (per requirement: no menu bar).
  // The Sidebar inside the renderer provides primary navigation instead.
  Menu.setApplicationMenu(null)
  // 传入主窗口 getter：IPC handlers 在注册时主窗口尚未创建，
  // 通过 getter 延迟到调用时再拿，窗口控制 / SSO 登录父窗口都依赖它。
  registerIpcHandlers(() => win)
  createWindow()
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})
