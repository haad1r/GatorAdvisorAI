import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const PAGES = ["/dashboard", "/schedule", "/settings", "/preview"]

for (const theme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`${path} has no axe violations (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([])
    })
  }
}
