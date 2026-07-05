import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

test.describe("GSC Search/Discovery card (#894)", () => {
  let seed: { email: string; password: string; websiteId: string; domain: string }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
  })

  test("renders the Search/Discovery card with synced GSC data", async ({ page }) => {
    // Step 1: Log in via the admin UI
    await page.goto("/app/login")
    await page.waitForLoadState("networkidle")

    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()

    // Wait until redirected away from /login (proves auth succeeded)
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })

    // Step 2: Navigate to the website analytics page
    await page.goto(`/app/websites/${seed.websiteId}/analytics`)
    await page.waitForLoadState("networkidle")

    // Step 3: Verify the Search/Discovery card is present with synced data
    const card = page.locator("text=Search / Discovery").first()
    await expect(card).toBeVisible({ timeout: 15000 })

    // The binding resource_id should be displayed
    await expect(page.locator(`text=${seed.domain}`).first()).toBeVisible()

    // Metric stats should be visible
    await expect(page.locator("text=Clicks").first()).toBeVisible()
    await expect(page.locator("text=Impressions").first()).toBeVisible()
    await expect(page.locator("text=CTR").first()).toBeVisible()
    await expect(page.locator("text=Avg. Position").first()).toBeVisible()

    // The chart area should render (recharts renders SVG inside a container)
    const chart = page.locator(".recharts-responsive-container svg")
    await expect(chart).toBeVisible({ timeout: 10000 })

    // "Top Queries" and "Top Pages" sections should be visible
    await expect(page.locator("text=Top Queries").first()).toBeVisible()
    await expect(page.locator("text=Top Pages").first()).toBeVisible()

    // At least one query/page row with a click count
    await expect(page.locator("text=clicks").first()).toBeVisible()

    // The "Sync Data" button should be present
    await expect(page.locator('button:has-text("Sync Data")').first()).toBeVisible()
  })
})
