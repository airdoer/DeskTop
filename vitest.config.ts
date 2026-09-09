import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: __dirname,
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    // e2e 由 playwright 单独执行（pnpm test:e2e），不应被 vitest 收集
    exclude: ['test/e2e/**'],
    passWithNoTests: true,
    testTimeout: 1000 * 29,
  },
})
