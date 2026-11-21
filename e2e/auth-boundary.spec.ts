import { expect, test } from "@playwright/test"

/*
 * Signed-out states only. Signing in needs a Clerk test user from Maria
 * (TEAM-01); until then these check the boundary the frontend owns.
 * Frontend redirects are not access control: the backend checks the token.
 */

test("signed out, the shell offers a sign-in link that opens Clerk", async ({ page, isMobile }) => {
  await page.goto("/dashboard")
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click()
  const scope = isMobile ? page.getByRole("dialog") : page.locator("aside")
  await scope.getByRole("link", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.locator(".cl-signIn-root")).toBeVisible({ timeout: 20_000 })
})

test("the sign-up page renders Clerk's form", async ({ page }) => {
  await page.goto("/sign-up")
  await expect(page.locator(".cl-signUp-root")).toBeVisible({ timeout: 20_000 })
})

test("an expired session shows a sign-in-again message, not a blank page", async ({ page }) => {
  await page.goto("/schedule?mock=expired")
  await expect(page.getByText("Your session expired")).toBeVisible()
  await expect(page.getByText("Sign in again to continue.")).toBeVisible()
})

test("a forbidden response says so", async ({ page }) => {
  await page.goto("/schedule?mock=forbidden")
  await expect(page.getByText("You don't have access")).toBeVisible()
})

for (const [path, title] of [
  ["/sign-in", "Sign in to GatorAdvisor AI"],
  ["/sign-up", "Create your account"],
  ["/onboarding", "Plan your UF degree with confidence."],
] as const) {
  test(`${path} has exactly one h1`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title, { timeout: 20_000 })
  })
}
