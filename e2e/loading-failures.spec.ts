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
