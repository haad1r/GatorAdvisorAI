import { expect, test } from "@playwright/test"

test.describe("top bar", () => {
  test.skip(({ isMobile }) => isMobile, "the program summary is hidden below sm")

  test("saving a new major updates the top bar without a reload", async ({ page }) => {
    await page.goto("/settings")
    const header = page.locator("header")
    await expect(header.getByText("Computer Science · 2025-2026 catalog")).toBeVisible()
    await page.locator("#major").selectOption("electrical-engineering")
    await page.getByRole("button", { name: "Save profile" }).click()
    await expect(page.getByText("Profile saved.")).toBeVisible()
    await expect(header.getByText("Electrical Engineering · 2025-2026 catalog")).toBeVisible()
  })

  test("leaving the deleted message through the sidebar shows Settings again", async ({ page }) => {
    await page.goto("/settings?account=deleted")
    await expect(page.getByText("Your account was deleted")).toBeVisible()
    await page.locator("aside").getByRole("link", { name: "Settings", exact: true }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible()
    await expect(page.getByText("Your account was deleted")).toHaveCount(0)
  })
})

test("changing the first term clears the graduation-order error", async ({ page }) => {
  await page.goto("/settings")
  await page.locator("#entryTerm").selectOption("Spring 2027")
  await page.locator("#expectedGraduation").selectOption("Spring 2027")
  await page.getByRole("button", { name: "Save profile" }).click()
  const orderError = page.getByText("Graduation has to come after your first term.").first()
  await expect(orderError).toBeVisible()
  await page.locator("#entryTerm").selectOption("Fall 2026")
  await expect(page.getByText("Graduation has to come after your first term.")).toHaveCount(0)
})

test("deleting the account says so, clears the top bar, and survives the sign-out redirect", async ({ page }) => {
  await page.goto("/settings")
  await page.getByRole("button", { name: "Delete account" }).click()
  await page.getByLabel('Type "delete" to confirm').fill("delete")
  await page.getByRole("dialog").getByRole("button", { name: "Delete account" }).click()
  await expect(page.getByText("Your account was deleted")).toBeVisible()
  await expect(page.getByText(/· \d{4}-\d{4} catalog/)).toHaveCount(0)

  await page.goto("/settings?account=deleted")
  await expect(page.getByText("you've been signed out")).toBeVisible()
})
