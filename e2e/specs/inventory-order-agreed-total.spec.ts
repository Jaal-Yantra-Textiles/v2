import { test, expect, request as pwRequest } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const BASE = "http://localhost:9000"

/**
 * #1617 — the AGREED payout total, entered where the order is created.
 *
 * The guard that lets an inventory order be paid in tranches measures live
 * claims against this figure. Without a way to enter it, every order falls back
 * to the ordered `total_price` — and those are not the same number: one real
 * order was priced at ₹63,375.75 and agreed at ₹35,000.
 *
 * 🔴 This spec exists because the API accepting a field proves nothing about
 * the form sending it. That is exactly how #1552 shipped: the screen was there,
 * the data path was wrong, and every test was green.
 */
test.describe("Inventory order — agreed payout total (#1617)", () => {
  let seed: { email: string; password: string }
  let token: string
  const stamp = Date.now()

  test.beforeAll(async () => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))

    const api = await pwRequest.newContext({ baseURL: BASE })
    const auth = await api.post("/auth/user/emailpass", {
      data: { email: seed.email, password: seed.password },
    })
    expect(auth.ok()).toBeTruthy()
    token = (await auth.json()).token
    const headers = { Authorization: `Bearer ${token}` }

    // A location must EXIST for the form's select to offer anything at all.
    const locations = await api.get("/admin/stock-locations?limit=1", { headers })
    expect(locations.ok()).toBeTruthy()
    expect((await locations.json()).stock_locations.length).toBeGreaterThan(0)
    await api.dispose()
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    // `networkidle` never settles against `medusa develop`, so wait on the form.
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  /**
   * ⚠️ Scope, stated plainly: this drives the FORM — that the field is there,
   * is reachable, and reports how far the agreed figure sits from the ordered
   * total. It does NOT submit, because a valid submit needs an order line typed
   * into the grid. That the value survives a create is covered by
   * `integration-tests/http/inventory-orders-api.spec.ts`, asserted on the
   * read-back rather than on the 201.
   *
   * So: the API contract is proven there, the field's presence and wiring here,
   * and the one link nothing covers is the form's own submit payload.
   */
  test("the agreed total is on the create form, and says how far it is from the order price", async ({
    page,
  }) => {
    await login(page)
    await page.goto("/app/orders/inventory/create")

    await expect(
      page.getByRole("heading", { name: /Inventory Order/i }).first()
    ).toBeVisible({ timeout: 30000 })

    /**
     * The General tab gates Continue on its required fields, so fill them —
     * a Continue that silently does nothing leaves the next assertion failing
     * for the wrong reason (it did, on the first run of this spec).
     */
    await page
      .getByRole("spinbutton", { name: "month, Expected Delivery Date" })
      .fill("12")
    await page
      .getByRole("spinbutton", { name: "day, Expected Delivery Date" })
      .fill("31")
    await page
      .getByRole("spinbutton", { name: "year, Expected Delivery Date" })
      .fill("2026")

    /**
     * ⚠️ Picks the FIRST option rather than a location this spec created. The
     * To Stock Location select lists a truncated page of locations, so a
     * freshly-created one is not necessarily in it — the same silent-truncation
     * shape as #1552, in a different screen. Out of scope here; noted because
     * the obvious version of this line fails for a reason that has nothing to
     * do with what is being tested.
     */
    await page.getByRole("combobox").first().click()
    await page.getByRole("option").first().click()

    await page.getByRole("button", { name: "Continue" }).click()
    await expect(page.getByRole("tab", { name: "Order Lines" })).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 15000 }
    )

    const agreed = page.getByLabel("Agreed payout total")
    await expect(agreed).toBeVisible({ timeout: 15000 })

    /**
     * The delta line, which is the whole reason the field sits beside the
     * ordered total: a mistyped agreed total is a ceiling on every future
     * payout for this order, so the form has to say how far off it is.
     */
    await agreed.fill("150")
    /**
     * No lines have been typed yet, so the ordered total is 0 and 150 is ABOVE
     * it. (The first version of this assertion expected "Below" and failed —
     * the code was right and the expectation was wrong.)
     */
    await expect(
      page.getByText("Above the order price by 150.00")
    ).toBeVisible({ timeout: 10000 })

    // Blank means "nobody recorded an agreed price", not zero — so the hint
    // disappears rather than claiming a difference.
    await agreed.fill("")
    await expect(page.getByText(/the order price by/)).toHaveCount(0)

    // And a figure equal to the order total reads as agreement, not a delta.
    await agreed.fill("0")
    await expect(page.getByText("Same as the order price.")).toBeVisible()
  })
})
