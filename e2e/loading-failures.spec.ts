import { expect, test } from "@playwright/test"

test("the schedule shows a loading state, then the week", async ({ page }) => {
  await page.goto("/schedule?mock=slow")
  await expect(page.getByRole("status").first()).toBeVisible()
  await page.goto("/schedule?mock=off")
  await expect(page.getByRole("article").first()).toBeVisible()
})

for (const [scenario, title] of [
  ["server", "Something went wrong on our side"],
  ["network", "You're offline"],
  ["quota", "Too many requests"],
] as const) {
  test(`a ${scenario} failure shows an error panel with a retry`, async ({ page }) => {
    await page.goto(`/schedule?mock=${scenario}`)
    await expect(page.getByText(title)).toBeVisible()
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
    await expect(page.getByRole("article")).toHaveCount(0)
  })
}

test("retrying after the backend recovers loads the schedule", async ({ page }) => {
  await page.goto("/schedule?mock=server")
  await expect(page.getByText("Something went wrong on our side")).toBeVisible()
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.toLowerCase().includes("mock")) localStorage.removeItem(key)
  })
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(page.getByRole("article").first()).toBeVisible()
})

test("the footer says when data freshness is unavailable", async ({ page }) => {
  await page.goto("/dashboard?mock=server")
  await expect(page.getByRole("contentinfo")).toContainText("Data freshness is unavailable right now.")
})

test("no request reaches /api while mocks are on", async ({ page }) => {
  const apiCalls: string[] = []
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/")) apiCalls.push(req.url())
  })
  await page.goto("/schedule")
  await expect(page.getByRole("article").first()).toBeVisible()
  expect(apiCalls).toEqual([])
})

test("the schedule's term follows the week shown", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-10T12:00:00-05:00"))
  await page.goto("/schedule")
  const range = page.getByRole("heading", { level: 2 }).first()
  await expect(range).toContainText("Fall 2026")
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Next week" }).click()
  await expect(range).toContainText("Spring 2027")
})

test("the footer shows the app's newest catalog", async ({ page }) => {
  await page.goto("/dashboard")
  await expect(page.getByRole("contentinfo")).toContainText("Catalog 2026-2027")
})
