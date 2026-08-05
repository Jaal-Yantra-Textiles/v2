import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * Customs HS/HSN gap scan + bulk fill.
 *
 * Shiprocket rejects EVERY international shipment whose lines lack an HSN, and
 * until now the only fix was editing variants one at a time. These routes make
 * it a bulk job, and this spec drives them against the live server so two
 * things are proven that unit tests can't:
 *
 *  1. The routes are actually MOUNTED. A route file with no matcher in
 *     `api/middlewares.ts` is not a route — that has bitten this codebase
 *     repeatedly, and it 404s identically to a typo'd path.
 *  2. A code written at the level the scan suggests is the level the LABEL
 *     reads back. Read and write agreeing is the entire point; if they drift,
 *     the tooling reports success while labels keep failing.
 *
 * Runs on CI: admin-only, no partner-UI server and no live LLM. The routes are
 * exercised through the browser's authenticated context (`page.request` shares
 * its cookies), not the assistant, so the assertions are deterministic.
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

type Seed = {
  email: string
  password: string
  hsnGapProductId: string
  hsnGapVariantId: string
}

let seed: Seed

test.describe("Customs HS-code scan + bulk fill", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.hsnGapProductId) {
      throw new Error("E2E seed missing hsnGapProductId — re-run the seed.")
    }
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/app/login")
    await page.waitForLoadState("networkidle")
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15_000 })
  })

  test("reports the gap, fills it, and the item stops being a gap", async ({
    page,
  }) => {
    // --- 1. The scan finds our seeded product ------------------------------
    // Paginate rather than assuming page 1 — the demo catalogue is seeded ahead
    // of ours, so a single-page assertion would be flaky by construction.
    let gap: any
    for (let offset = 0; offset < 600 && !gap; offset += 200) {
      const res = await page.request.get(
        `/admin/customs/hs-codes/missing?limit=200&offset=${offset}`
      )
      expect(res.status(), "scan route must be mounted").toBe(200)
      const body = await res.json()
      gap = body.gaps.find((g: any) => g.product_id === seed.hsnGapProductId)
      if (!body.has_more) break
    }

    expect(gap, "seeded HSN-gap product should be reported as a gap").toBeTruthy()

    // Context the model needs to classify the goods — without these the tool
    // can only guess, which it is explicitly forbidden from doing.
    expect(gap.product_title).toContain("Kutch Mirror-Work Stole")
    expect(gap.description).toContain("cotton stole")
    expect(gap.material).toBe("Cotton")
    expect(gap.current).toMatchObject({
      variant: null,
      inventory_item: null,
      product: null,
    })

    // The placement rule: variants exist but manage no inventory, so the code
    // belongs at the PRODUCT top level where it covers every sibling at once.
    expect(gap.manage_inventory).toBe(false)
    expect(gap.suggested_target).toEqual({
      level: "product",
      id: seed.hsnGapProductId,
    })

    // --- 2. Bulk fill at the suggested level -------------------------------
    const apply = await page.request.post("/admin/customs/hs-codes", {
      data: {
        assignments: [
          {
            level: gap.suggested_target.level,
            id: gap.suggested_target.id,
            hs_code: "6214",
            origin_country: "IN",
          },
        ],
      },
    })
    expect(apply.status(), "bulk route must be mounted").toBe(200)
    const applied = await apply.json()
    expect(applied).toMatchObject({ applied: 1, errors: 0, skipped: 0 })
    expect(applied.results[0]).toMatchObject({ status: "applied" })

    // --- 3. It really landed, and the gap is closed ------------------------
    const product = await page.request.get(
      `/admin/products/${seed.hsnGapProductId}`
    )
    expect((await product.json()).product.hs_code).toBe("6214")

    let stillAGap = false
    for (let offset = 0; offset < 600; offset += 200) {
      const res = await page.request.get(
        `/admin/customs/hs-codes/missing?limit=200&offset=${offset}`
      )
      const body = await res.json()
      if (body.gaps.some((g: any) => g.product_id === seed.hsnGapProductId)) {
        stillAGap = true
        break
      }
      if (!body.has_more) break
    }
    expect(
      stillAGap,
      "a product-level code must satisfy the chain the label reads"
    ).toBe(false)
  })

  test("a bad row does not discard the rest of the batch", async ({ page }) => {
    // Non-transactional on purpose: one stale id in a hundred-row batch must
    // not throw away the ninety-nine good writes.
    const res = await page.request.post("/admin/customs/hs-codes", {
      data: {
        assignments: [
          { level: "variant", id: "variant_does_not_exist", hs_code: "6214" },
          { level: "variant", id: seed.hsnGapVariantId, hs_code: "6215" },
        ],
      },
    })

    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.applied).toBe(1)
    expect(body.errors).toBe(1)
    expect(body.results[0]).toMatchObject({
      id: "variant_does_not_exist",
      status: "error",
    })
    expect(body.results[1]).toMatchObject({
      id: seed.hsnGapVariantId,
      status: "applied",
    })
  })

  test("rejects a malformed batch at the validator", async ({ page }) => {
    // Proves the matcher wires validateAndTransformBody, not just the handler.
    const res = await page.request.post("/admin/customs/hs-codes", {
      data: { assignments: [{ level: "galaxy", id: "x", hs_code: "6214" }] },
    })
    expect(res.status()).toBe(400)
  })
})
