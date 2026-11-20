import { defineConfig, devices } from "@playwright/test"

const PORT = 3001

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    /* #12 asks for 375px; Chromium with a phone viewport and touch. */
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
  /*
   * Reuses a running `npm run dev`, which must have every endpoint mocked.
   * A server it starts gets that here; these win over .env.local, even when empty.
   */
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}/preview`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { NEXT_PUBLIC_API_MOCKS: "true", NEXT_PUBLIC_API_LIVE: "" },
  },
})
