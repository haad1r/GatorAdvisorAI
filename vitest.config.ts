import { configDefaults, defineConfig } from "vitest/config"

// Playwright specs under e2e/ run with `npm run test:e2e`, not vitest.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
})
