import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * A design's garment type, on screen (#938).
 *
 * 🔑 Why this file exists: `product_type` shipped with a model behind it, an
 * inference workflow, unit tests and an edit-drawer field — and it was
 * displayed on no page at all. A value you can set and never see is half a
 * feature, and nothing in tsc, the unit suite or `check:prod-build` can tell
 * you a row is missing from a detail page.
 *
 * The second assertion is the one that matters most. An inferred type is
 * PROVISIONAL: it is a model's guess, it is what a human correction
 * overwrites, and the model that produced it returned prose instead of JSON on
 * every call until #1487 fixed the read path. Showing it identically to a type
 * a designer chose would launder a guess into a decision.
 */
test.describe("Design garment type (#938)", () => {
  let seed: {
    email: string
    password: string
    allocationDesignId: string
    allocationDesignName: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.allocationDesignId) {
      throw new Error("E2E seed missing allocationDesignId — re-run the seed.")
    }
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  test("shows the garment type beside the design type, not instead of it", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/designs/${seed.allocationDesignId}`)

    await expect(page.getByText("Garment Type")).toBeVisible({ timeout: 30000 })
    await expect(page.getByText("stole", { exact: true })).toBeVisible()

    // 🔑 Both, and they are different questions. `design_type` says how
    // original the work is; `product_type` says what the thing IS. The fixture
    // is an Original that is a stole, so a page that had merged the two rows
    // would fail here rather than look plausible.
    await expect(page.getByText("Design Type")).toBeVisible()
    await expect(page.getByText("Original", { exact: true })).toBeVisible()
  })

  test("🔑 badges an inferred type as provisional", async ({ page }) => {
    await login(page)
    await page.goto(`/app/designs/${seed.allocationDesignId}`)

    await expect(page.getByText("Garment Type")).toBeVisible({ timeout: 30000 })
    // The fixture's type came from a model (`product_type_source: "inferred"`).
    // Without this badge a guess and a designer's decision look identical, and
    // the guess is the one that should be overwritten without ceremony.
    await expect(page.getByText("Inferred", { exact: true })).toBeVisible()
  })
})
