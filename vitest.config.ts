import path from 'node:path'
import { defineConfig } from 'vitest/config'

// 注意：Vite 8 起配置按 ESM 解析（configLoader: 'native'），CJS 的 `__dirname` 已不再受支持
// （当前仍可加载，但每次运行都会打印弃用警告，未来默认切到 native 后会真正失效），
// 统一改用 `import.meta.dirname`（要求 Node >= 20.11）。
//
// Windows 运行提示：若终端工作目录的盘符是小写（如 e:\Code\...），vitest 会因盘符大小写
// 不一致加载到第二份 runtime，导致所有 suite 收集到 0 个用例并抛
// `TypeError: Cannot read properties of undefined (reading 'config')`（vitest 已知缺陷）。
// 用大写盘符进入目录后再执行即可：cd E:/Code/github/DeskTop && npx vitest run
export default defineConfig({
  // 与 vite.config.ts 的 '@' → src 保持一致：跨模块 import 用别名，
  // 单测若不做同样映射会在解析阶段直接失败。
  resolve: {
    alias: {
      '@': path.join(import.meta.dirname, 'src'),
    },
  },
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    // e2e 由 playwright 单独执行（pnpm test:e2e），不应被 vitest 收集
    exclude: ['test/e2e/**'],
    passWithNoTests: true,
    testTimeout: 1000 * 29,
  },
})
