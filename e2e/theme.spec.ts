import { expect, test } from "@playwright/test"

const html = (page: import("@playwright/test").Page) => page.locator("html")

test("with no saved choice the theme follows the OS", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto("/dashboard")
  await expect(html(page)).toHaveClass(/\bdark\b/)

  await page.emulateMedia({ colorScheme: "light" })
  await expect(html(page)).not.toHaveClass(/\bdark\b/)
})

test("the toggle switches the theme and the choice survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/dashboard")

  await page.getByRole("button", { name: "Switch to dark theme" }).click()
  await expect(html(page)).toHaveClass(/\bdark\b/)
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible()

  await page.reload()
  await expect(html(page)).toHaveClass(/\bdark\b/)

  /* A saved choice beats the OS setting. */
  await page.emulateMedia({ colorScheme: "light" })
  await expect(html(page)).toHaveClass(/\bdark\b/)
})

test("a saved dark theme is applied before first paint", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"))
  await page.goto("/dashboard", { waitUntil: "commit" })
  await page.waitForSelector("body")
  await expect(html(page)).toHaveClass(/\bdark\b/)
})
