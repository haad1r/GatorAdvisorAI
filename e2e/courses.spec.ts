import { expect, test } from "@playwright/test"

test("a new search shows loading, never the previous search's results", async ({ page }) => {
  await page.goto("/courses?q=COP3530&mock=off")
  const previous = page.locator('a[href="/courses/cop3530"]')
  await expect(previous).toBeVisible()

  await page.goto("/courses?q=COP3530&mock=slow")
  await expect(previous).toBeVisible({ timeout: 10_000 })
  await page.getByLabel("Search courses").fill("MAC2311")
  await expect(page.getByRole("status").first()).toBeVisible()
  await expect(previous).toHaveCount(0)
  await expect(page.locator('a[href="/courses/mac2311"]')).toBeVisible({ timeout: 10_000 })
})
