import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 与 vite.config.ts 的 '@' → src 保持一致：跨模块 import 用别名，
  // 单测若不做同样映射会在解析阶段直接失败。
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
  },
  test: {
    root: __dirname,
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    // e2e 由 playwright 单独执行（pnpm test:e2e），不应被 vitest 收集
    exclude: ['test/e2e/**'],
    passWithNoTests: true,
    testTimeout: 1000 * 29,
  },
})
