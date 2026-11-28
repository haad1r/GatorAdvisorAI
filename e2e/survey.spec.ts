import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

/* #19 part A: the interest survey, as the last onboarding step and as a retake from Settings. */

const Q1 = "#interests"
const Q2 = "#lower_interest_topics"

async function finishProfile(page: Page, major = "computer-science") {
  await page.goto("/onboarding")
  await page.locator("#preferredName").fill("Test Student")
  await page.locator("#classStanding").selectOption("sophomore")
  await page.getByRole("button", { name: "Continue" }).click()
  await page.locator("#major").selectOption(major)
  await page.locator("#catalogYear").selectOption("2025-2026")
  await page.locator("#entryTerm").selectOption("Fall 2025")
  await page.locator("#expectedGraduation").selectOption("Spring 2029")
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("button", { name: "Save and continue" }).click()
  await expect(page.getByRole("heading", { name: "Interests" })).toBeFocused()
}

const topic = (page: Page, question: string, name: string) =>
  page.locator(question).getByRole("checkbox", { name, exact: true })

async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)
}

test("onboarding ends with the survey, and saving it finishes setup", async ({ page }) => {
  await finishProfile(page)
  await expect(page.getByText("Step 4 of 4")).toBeVisible()
  await expect(page.locator("#major_scope")).toBeVisible()

  await topic(page, Q1, "AI & Data Science").check()
  await page.getByRole("radio", { name: "Advanced (3000-4000 level)" }).check()
  await page.getByRole("button", { name: "Save and finish" }).click()

  await expect(page.getByRole("heading", { name: "You're all set, Test Student." })).toBeVisible()
  await expect(page.getByText("Your interests are saved")).toBeVisible()
})

test("a topic picked in one list is turned off in the other, with a reason", async ({ page }) => {
  await finishProfile(page)
  await topic(page, Q1, "Politics & Law").check()
  await expect(topic(page, Q2, "Politics & Law")).toBeDisabled()
  await expect(page.getByText("Topics you picked as interests above are turned off here.")).toBeVisible()

  await topic(page, Q1, "Politics & Law").uncheck()
  await expect(topic(page, Q2, "Politics & Law")).toBeEnabled()
  await expect(page.getByText("Topics you picked as interests above are turned off here.")).toHaveCount(0)
})

test("undeclared students don't see Q3, start at 'exploring', and can skip", async ({ page }) => {
  await finishProfile(page, "undeclared")
  await expect(page.locator("#major_scope")).toHaveCount(0)
  await expect(page.getByRole("radio", { name: "Yes, still exploring" })).toBeChecked()

  await page.getByRole("button", { name: "Skip for now" }).click()
  await expect(page.getByText("You can take the interest survey any time from Settings.")).toBeVisible()
})

test("each question can be cleared", async ({ page }) => {
  await finishProfile(page)
  await page.getByRole("radio", { name: "Intro (1000-2000 level)" }).check()
  await page.getByRole("button", { name: "Clear answer: Course level" }).click()
  await expect(page.getByRole("radio", { name: "Intro (1000-2000 level)" })).not.toBeChecked()
  await expect(page.getByRole("button", { name: "Clear answer: Course level" })).toHaveCount(0)
})

test("topics and options work by keyboard", async ({ page }) => {
  await finishProfile(page)
  await topic(page, Q1, "Programming & Software").focus()
  await page.keyboard.press("Space")
  await expect(topic(page, Q1, "Programming & Software")).toBeChecked()

  await page.getByRole("radio", { name: "Mostly inside my major" }).focus()
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("radio", { name: "A mix" })).toBeChecked()
})

test("a failed save keeps every answer and can be retried", async ({ page }) => {
  await page.goto("/settings/survey?mock=validation")
  await topic(page, Q1, "Biology & Life Sciences").check()
  await page.getByRole("radio", { name: "Yes", exact: true }).check()
  await page.getByRole("button", { name: "Save answers" }).click()

  await expect(page.getByText("We couldn't save your answers")).toBeVisible()
  await expect(topic(page, Q1, "Biology & Life Sciences")).toBeChecked()
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeChecked()

  await page.evaluate(() => localStorage.removeItem("api-mock-scenario"))
  await page.getByRole("button", { name: "Save answers" }).click()
  await expect(page.getByRole("heading", { name: "Survey saved" })).toBeVisible()
})

test("Settings opens the survey, and a retake is pre-filled with the last answers", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.getByText("You haven't taken the survey yet.")).toBeVisible()
  await page.getByRole("button", { name: "Take survey" }).click()
  await expect(page).toHaveURL(/\/settings\/survey$/)

  await topic(page, Q1, "Music, Theater & Dance").check()
  await topic(page, Q2, "Finance, Accounting & Economics").check()
  await page.getByRole("radio", { name: "No, I know what I want" }).check()
  await page.getByRole("button", { name: "Save answers" }).click()
  await expect(page.getByRole("heading", { name: "Survey saved" })).toBeVisible()

  await page.getByRole("button", { name: "Back to Settings" }).click()
  await expect(page.getByText(/^Last taken /)).toBeVisible()
  await page.getByRole("button", { name: "Retake survey" }).click()

  await expect(page.getByRole("heading", { name: "Retake the interest survey" })).toBeVisible()
  await expect(topic(page, Q1, "Music, Theater & Dance")).toBeChecked()
  await expect(topic(page, Q2, "Finance, Accounting & Economics")).toBeChecked()
  await expect(page.getByRole("radio", { name: "No, I know what I want" })).toBeChecked()
  await expect(page.getByRole("radio", { name: "A mix" })).not.toBeChecked()
})

for (const theme of ["light", "dark"] as const) {
  test(`the survey step has no axe violations, including turned-off topics (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await finishProfile(page)
    await topic(page, Q1, "AI & Data Science").check()
    await topic(page, Q2, "Politics & Law").check()
    await page.getByRole("radio", { name: "Advanced (3000-4000 level)" }).check()
    expect(await axe(page)).toEqual([])
  })
}
