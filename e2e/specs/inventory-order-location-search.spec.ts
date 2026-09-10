import { test, expect, request as pwRequest } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const BASE = "http://localhost:9000"

/**
 * The Create Inventory Order "To / From Stock Location" pickers are searchable
 * comboboxes (the ariakit Combobox used by the data grid and the CRM forms),
 * not plain `Select`s.
 *
 * What that has to mean in a browser, and what this spec holds it to:
 *
 *  1. EVERY location is offered — the list route defaults to `limit: 20`, so
 *     a picker fed by the plain list call silently drops every location past
 *     that row (the truncation class of #947/#1552). The fixtures push the
 *     store past one page, so the count assertion is not vacuous.
 *  2. Typing narrows: a warehouse found by name, a query that matches nothing
 *     reads as no-results rather than as a full list.
 *  3. The picked values live in the form, not just in the widget: the
 *     schema's "from and to must differ" rule fires on a duplicate pair, and
 *     stops firing once the optional From is cleared — the same code path a
 *     buyer's Continue click takes.
 */
test.describe("Inventory order location pickers are searchable", () => {
  let seed: { email: string; password: string }
  let token: string
  /** Locations this spec created — removed in afterAll so runs stay idempotent. */
  const createdIds: string[] = []
  const stamp = Date.now()
  /**
   * The trailing number+letter is load-bearing, not decoration: the picker
   * filters with matchSorter, whose MATCHES ranking matches the query as a
   * character SUBSEQUENCE — so "… Facility 11" fuzzy-matches "… Facility 1"
   * + any later "1" (ten siblings!), and a "narrows to exactly one"
   * assertion written against bare numbers cannot pass against the widget
   * behaving exactly as designed (the CRM pickers are immune only because
   * their fixture names are single tokens). Zero-padded two-digit numbers
   * are not a subsequence of one another, and the unique last letter rules
   * out skip-matching across number pairs ("7h" still matched "17r").
   */
  const locName = (i: number) =>
    `E2E InvOrder ${stamp} Facility ${String(i).padStart(2, "0")}${String.fromCharCode(97 + i)}`
  /** Enough to push the store past the list route's default 20-row page. */
  const FILLER_COUNT = 24

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

    for (let i = 0; i < FILLER_COUNT; i++) {
      const res = await api.post("/admin/stock-locations", {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: locName(i) },
      })
      expect([200, 201]).toContain(res.status())
      createdIds.push((await res.json()).stock_location.id)
    }
    await api.dispose()
  })

  test.afterAll(async () => {
    if (!createdIds.length) return
    const api = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    })
    for (const id of createdIds) {
      await api.delete(`/admin/stock-locations/${id}`)
    }
    await api.dispose()
  })

  const login = async (page: import("@playwright/test").Page) => {
    await page.goto("/app/login")
    // `networkidle` never settles against `medusa develop` (the dev server holds
    // long-lived connections open), so wait on the form itself.
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  const openCreateForm = async (page: import("@playwright/test").Page) => {
    await login(page)
    await page.goto("/app/orders/inventory/create")
    await expect(
      page.getByRole("heading", { name: "Create Inventory Order" })
    ).toBeVisible({ timeout: 20000 })
  }

  /**
   * Pick `name` in the field under `testId`: open, narrow to the one match,
   * select it. Returns nothing — the caller asserts what the field shows.
   */
  const pick = async (
    page: import("@playwright/test").Page,
    testId: string,
    name: string
  ) => {
    const field = page.getByTestId(testId)
    await field.getByRole("combobox").click()
    await field.getByRole("combobox").fill(name)
    await expect(page.getByRole("option")).toHaveCount(1)
    await page.getByRole("option").first().click()
    /**
     * Blur and assert the popover is shut BEFORE reading the field: the
     * Combobox renders its option list INSIDE the wrapper, so a wrapper that
     * "contains the name" may just be showing an open dropdown with that
     * option somewhere in it — a different claim from the field being
     * selected. (The negative control for crm-open-a-deal showed exactly
     * that: every option, concatenated.)
     */
    await page.getByRole("heading", { name: "Create Inventory Order" }).click()
    await expect(page.getByRole("option")).toHaveCount(0)
  }

  test("offers every location, and narrows by what is typed", async ({
    page,
  }) => {
    const api = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    })
    const res = await api.get("/admin/stock-locations?limit=1")
    const total = (await res.json()).count
    await api.dispose()
    // The beforeAll fixtures alone put us past the default page — if they
    // somehow did not, the count assertion below is vacuous, so fail loudly
    // instead of certifying a truncation bug it cannot see.
    expect(total).toBeGreaterThan(20)

    await openCreateForm(page)

    const to = page.getByTestId("inventory-order-to-location")
    await to.getByRole("combobox").click()

    /**
     * Every location, counted — not "the one I created is present". Presence
     * alone passes on a truncated list whenever the fixture lands early; the
     * count is what the default-limit truncation actually changes (20 vs
     * total), which is exactly the bug the fetch-all hook exists to prevent.
     */
    await expect
      .poll(async () => await page.getByRole("option").count(), {
        timeout: 20000,
      })
      .toBe(total)

    // A query that matches nothing reads as no-results, not as the full list.
    await to.getByRole("combobox").fill(`no such facility ${stamp}`)
    await expect(page.getByRole("option")).toHaveCount(0)

    // The name is what the user knows — typing it must find THE warehouse.
    await to.getByRole("combobox").fill(locName(23))
    await expect(page.getByRole("option")).toHaveCount(1)
    await page.getByRole("option").first().click()
    await page.getByRole("heading", { name: "Create Inventory Order" }).click()
    await expect(page.getByRole("option")).toHaveCount(0)
    await expect(to).toContainText(locName(23))

    // The From picker searches the same way — a transfer needs both ends.
    const from = page.getByTestId("inventory-order-from-location")
    await from.getByRole("combobox").click()
    await from.getByRole("combobox").fill(locName(7))
    await expect(page.getByRole("option")).toHaveCount(1)
    await page.getByRole("option").first().click()
    await page.getByRole("heading", { name: "Create Inventory Order" }).click()
    await expect(page.getByRole("option")).toHaveCount(0)
    await expect(from).toContainText(locName(7))
  })

  test("the picked pair goes through the form: duplicates refused, optional From clearable", async ({
    page,
  }) => {
    await openCreateForm(page)

    /**
     * The from≠to rule lives in the schema's superRefine chain, and zod only
     * runs refinements once the base object parses — so with the required
     * delivery date still empty, Continue surfaces only THAT error and the
     * duplicate pair sails past this screen's gate (verified against the real
     * resolver: one issue, no refinement messages). The rule the buyer meets
     * is the one with the dates valid, so that is the form this drives.
     * (Order lines stay empty on purpose: with dates valid the refinements
     * DO run, and Continue only re-validates the General-tab fields.)
     */
    const delivery = page.getByRole("group", { name: "Expected Delivery Date" })
    await delivery.click()
    // react-aria segments: month/day/year, auto-advancing per completed segment.
    await page.keyboard.type("09152026")

    // The SAME location at both ends is not a transfer.
    const to = page.getByTestId("inventory-order-to-location")
    const from = page.getByTestId("inventory-order-from-location")
    await pick(page, "inventory-order-to-location", locName(11))
    await expect(to).toContainText(locName(11))
    await pick(page, "inventory-order-from-location", locName(11))
    await expect(from).toContainText(locName(11))

    await page.getByRole("button", { name: "Continue" }).click()
    /**
     * The schema's rule, not the widget's: this fires only because the
     * combobox wrote real values into react-hook-form — a picker that kept
     * the selection to itself leaves the rule silent and the pair ships.
     */
    const duplicateError = page.getByText(
      "From and To stock locations must be different"
    )
    await expect(duplicateError).toBeVisible()

    // From is optional — clearing it must clear it in the FORM too. (The
    // clear button is the combobox's X, rendered when `allowClear` is on and
    // a value is held; it is the only button in the widget offset from the
    // disclosure chevron.)
    await from.locator('button[class*="end-[28px]"]').click()
    // The X unmounts mid-clear and focus hops to the input, which re-opens the
    // popover — tab out so the next Continue click has no open list to fight.
    await from.getByRole("combobox").press("Tab")

    /**
     * Cleared is not "": an empty From makes the pair valid, and Continue —
     * which re-validates exactly the four General fields — must now advance
     * to Order Lines. Staying put would mean the X left a stale string in
     * the form state (or nothing changed at all).
     */
    await page.getByRole("button", { name: "Continue" }).click()
    await expect(duplicateError).toHaveCount(0)
    await expect(page.getByRole("tab", { name: "Order Lines" })).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 10000 }
    )
  })
})
