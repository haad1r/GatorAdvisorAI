import { expect, test } from "@playwright/test"

const PAGES = [
  ["/dashboard", "Dashboard"],
  ["/audit", "Degree audit"],
  ["/courses", "Courses"],
  ["/recommendations", "Recommendations"],
  ["/plan", "Plan"],
  ["/schedule", "Schedule"],
  ["/advisor", "Advisor"],
  ["/import", "Import"],
  ["/settings", "Settings"],
] as const

test("the root redirects to the dashboard", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard")
})

test("the skip link is the first tab stop and moves focus to the content", async ({ page }) => {
  await page.goto("/dashboard")
  await page.keyboard.press("Tab")
  const skip = page.getByRole("link", { name: "Skip to content" })
  await expect(skip).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.locator("#main")).toBeFocused()
})

test.describe("desktop", () => {
  test.skip(({ isMobile }) => isMobile, "sidebar is desktop only")

  test("every sidebar link opens its page and marks itself current", async ({ page }) => {
    await page.goto("/dashboard")
    const sidebar = page.locator("aside")
    for (const [href, label] of PAGES) {
      await sidebar.getByRole("link", { name: label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(label)
      await expect(sidebar.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page")
    }
  })
})

test.describe("mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "tab bar and menu are below lg only")

  test("the tab bar has the five main pages", async ({ page }) => {
    await page.goto("/dashboard")
    const tabs = page.getByRole("navigation", { name: "Primary" }).getByRole("link")
    await expect(tabs).toHaveText(["Home", "Audit", "Plan", "Schedule", "Advisor"])
    await tabs.filter({ hasText: "Schedule" }).click()
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schedule")
    await expect(tabs.filter({ hasText: "Schedule" })).toHaveAttribute("aria-current", "page")
  })

  test("the menu opens, navigates, and closes", async ({ page }) => {
    await page.goto("/dashboard")
    const opener = page.getByRole("button", { name: "Open menu" })

    await opener.click()
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(opener).toBeFocused()

    await opener.click()
    await page.getByRole("dialog").getByRole("link", { name: "Courses" }).click()
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Courses")
  })

  test("no page scrolls sideways at 375px", async ({ page }) => {
    for (const [href] of [...PAGES, ["/preview"] as const]) {
      await page.goto(href)
      await page.waitForLoadState("networkidle")
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, href).toBeLessThanOrEqual(0)
    }
  })
})
