import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

// #1112 — a product sold and fulfilled from produced stock retroactively mints a
// COMPLETED product-only production run (design_id null) hung off the product
// spine. This run surfaces in the existing "Linked Designs" widget's
// product-level "Production Runs" section — even though the product has NO
// linked design. Drives it headlessly against the seeded product so CI does the
// browser verification.
test.describe("Product production-runs provenance section (#1112)", () => {
  let seed: { email: string; password: string; provenanceProductId: string }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.provenanceProductId) {
      throw new Error("E2E seed missing provenanceProductId — re-run the seed.")
    }
  })

  test("shows the completed retail run in the product's Production Runs section", async ({
    page,
  }) => {
    // Log in via the admin UI.
    await page.goto("/app/login")
    await page.waitForLoadState("networkidle")
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })

    // Open the seeded (design-less) product's detail page.
    await page.goto(`/app/products/${seed.provenanceProductId}`)
    await page.waitForLoadState("networkidle")

    // The product-level Production Runs section (from the Linked Designs widget).
    await expect(
      page.getByText("Production Runs", { exact: true }).first()
    ).toBeVisible({ timeout: 15000 })

    // The provenance subtitle that distinguishes retail runs.
    await expect(
      page.getByText("from fulfilled orders").first()
    ).toBeVisible()

    // The run is born completed (status badge) with a produced quantity.
    await expect(page.getByText("Completed").first()).toBeVisible()
  })
})
