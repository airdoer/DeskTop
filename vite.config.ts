import { rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { electronSimple } from 'vite-plugin-electron/multi-env'
import { notBundle } from 'vite-plugin-electron/plugin'
import pkg from './package.json' with { type: 'json' }

const external = Object.keys(
  'dependencies' in pkg ? (pkg.dependencies as Record<string, string>) : {},
)

// 自定义 Electron 启动：用 detached + stdio:'ignore'，避免 vite-plugin-electron
// 默认 stdio:'inherit' 在非交互式终端下导致 electron 立即退出连带 vite 退出。
// 同时让 electron 独立于 vite 进程组，vite 退出时手动 kill 避免僵尸进程。
let electronProc: ReturnType<typeof spawn> | null = null
function spawnElectron(root: string) {
  const require = createRequire(path.join(root, 'package.json'))
  const electronPath = require('electron')
  const entry = path.join(root, 'dist-electron/main/index.js')
  electronProc?.kill()
  electronProc = spawn(electronPath, [entry, '--no-sandbox'], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
  })
  electronProc.on('exit', () => { electronProc = null })
  // vite 进程退出时清理 electron，避免僵尸进程
  process.once('exit', () => { electronProc?.kill() })
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  rmSync('dist-electron', { recursive: true, force: true })

  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG

  return {
    resolve: {
      alias: {
        // Vite 8 起配置按 ESM 解析，CJS 的 `__dirname` 已弃用，统一用 `import.meta.dirname`
        '@': path.join(import.meta.dirname, 'src'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      electronSimple({
        main: {
          input: 'electron/main/index.ts',
          plugins: [notBundle()],
          onstart: (args: { startup: (argv?: string[], opts?: Record<string, unknown>) => void; reload: () => void }) => {
            // 第一次启动时自接管 electron spawn（detached + stdio:'ignore'），
            // 之后 main 重建走 reload（只发 HMR，不重启 electron）
            if (electronProc) {
              args.reload()
            } else {
              spawnElectron(process.cwd())
            }
          },
          options: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rolldownOptions: {
                external,
              },
            },
          },
        },
        preload: {
          input: 'electron/preload/index.ts',
          plugins: [notBundle()],
          options: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined, // #332
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rolldownOptions: {
                external,
              },
            },
          },
        },
        // Polyfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        // renderer: {},
      }),
    ],
    clearScreen: false,
  }
})
