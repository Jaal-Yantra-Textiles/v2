import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #1195 — the admin half of the "Mark as shipped" gate.
 *
 * The admin dashboard gate lives inside the SHIPPED `@medusajs/dashboard`
 * bundle (`order-detail-*.mjs`), so unlike the partner UI we cannot patch it:
 *
 *   !canceled_at && !shipped_at && !delivered_at
 *   && fulfillment.requires_shipping && !isPickUpFulfillment
 *
 * `requires_shipping` is derived (`hasShippingProfile ||
 * someInventoryRequiresShipping`) and copied onto the fulfillment, so most of
 * our catalogue lands on `false` and the action vanishes — with the pickup rule,
 * the only restriction Medusa documents, never coming into play.
 *
 * Repairing the DATA is therefore the only lever in admin, which is what the
 * `backfill-open-order-requires-shipping` maintenance job does. This spec pins
 * the whole loop end-to-end in a real browser:
 *
 *   1. the seeded fixture (requires_shipping=false, NON-pickup) hides the action
 *   2. the DP job repairs the fulfillment
 *   3. the action appears, with nothing else about the order changed
 *
 * Step 1 asserts stock upstream behaviour. If a Medusa upgrade drops the
 * undocumented term, this fails — and that failure is GOOD NEWS: it means the
 * backfill is no longer needed.
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

type Seed = {
  email: string
  password: string
  gateOrderId: string
  gateFulfillmentId: string
}

const seed: Seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))

const MARK_AS_SHIPPED = /mark as shipped/i

test.describe("#1195 requires_shipping gate — admin order detail", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app/login")
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app(?!\/login)/, { timeout: 60_000 })
  })

  test("the DP backfill restores the hidden shipment action", async ({
    page,
    request,
  }) => {
    const orderUrl = `/app/orders/${seed.gateOrderId}`

    const auth = await request.post("/auth/user/emailpass", {
      data: { email: seed.email, password: seed.password },
    })
    expect(auth.ok()).toBeTruthy()
    const token = (await auth.json()).token

    // This spec REPAIRS its own fixture, so it only means anything on a fresh
    // seed. CI re-seeds every run; locally, re-run `pnpm e2e:seed` first. Assert
    // the precondition explicitly rather than failing later on a confusing
    // "button already visible".
    const precheck = await request.get(
      `/admin/orders/${seed.gateOrderId}?fields=id,fulfillments.id,fulfillments.requires_shipping`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const seededFulfillment = (await precheck.json()).order.fulfillments.find(
      (f: any) => f.id === seed.gateFulfillmentId
    )
    expect(
      seededFulfillment?.requires_shipping,
      "gate fixture already repaired — re-run `pnpm e2e:seed` (this spec mutates it)"
    ).toBe(false)

    // ── 1. broken: the fulfillment is there, the action is not ────────────
    await page.goto(orderUrl)
    await expect(page.getByText(/fulfilled/i).first()).toBeVisible()
    await expect(
      page.getByRole("button", { name: MARK_AS_SHIPPED })
    ).toHaveCount(0)

    // ── 2. repair, through the ops route an operator would use ────────────
    const dry = await request.post(
      "/admin/ops/maintenance-jobs/backfill-open-order-requires-shipping/run",
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { dry_run: true, params: { order_id: seed.gateOrderId } },
      }
    )
    expect(dry.ok()).toBeTruthy()
    const dryResult = (await dry.json()).result
    expect(dryResult.applied).toBe(false)
    expect(
      dryResult.changes.some(
        (c: any) =>
          c.entity === "fulfillment" && c.id === seed.gateFulfillmentId
      )
    ).toBe(true)

    // Dry-run must not have moved anything.
    await page.reload()
    await expect(
      page.getByRole("button", { name: MARK_AS_SHIPPED })
    ).toHaveCount(0)

    const applied = await request.post(
      "/admin/ops/maintenance-jobs/backfill-open-order-requires-shipping/run",
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { dry_run: false, params: { order_id: seed.gateOrderId } },
      }
    )
    expect(applied.ok()).toBeTruthy()
    expect((await applied.json()).result.applied).toBe(true)

    // ── 3. fixed: the action the operator was missing ─────────────────────
    await page.reload()
    await expect(
      page.getByRole("button", { name: MARK_AS_SHIPPED })
    ).toBeVisible({ timeout: 30_000 })
  })
})
