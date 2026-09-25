import { test, expect, type Page } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #2264 — work orders, end to end: what a PARTNER sees in partner-ui, and that
 * the ADMIN never opens one in the core order (sale) screen.
 *
 * Fixture (e2e-seed.ts `seedWorkOrdersFixture`): partner A holds an inventory
 * work order and a one-run design work order; partner B holds a collated
 * design work order of two designs.
 *
 * 🔑 Runs TWICE on CI (.github/workflows/e2e.yml): once as the whole suite with
 * `WORK_ORDER_READS` off — what prod serves today — and once, `--grep
 * @workorders`, with it ON. Playwright's webServer inherits this process's
 * env, so `process.env.WORK_ORDER_READS` here IS the backend's flag, and every
 * API read asserts WHICH source answered: the core mirror carries the internal
 * "Partner Work Orders" sales channel, `work_order` serves
 * `sales_channel_id: null`. A flag-on run that silently fell back to core
 * fails here instead of passing.
 *
 * READ-ONLY: nothing is accepted, cancelled or edited, so re-runs and retries
 * see the same fixture.
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"
const BACKEND = process.env.E2E_BACKEND_URL || `http://localhost:${process.env.E2E_BACKEND_PORT || 9000}`
const FROM_WORK_ORDER = String(process.env.WORK_ORDER_READS ?? "").toLowerCase() === "true"

type Seed = {
  email: string
  password: string
  woPartnerAEmail: string
  woPartnerBEmail: string
  woPassword: string
  woInventoryOrderId: string
  woInventoryWorkOrderId: string
  woInventoryLineTitle: string
  woRunId: string
  woDesignWorkOrderId: string
  woDesignName: string
  woCollatedWorkOrderId: string
  woCollatedDesignNames: string[]
}

const loadSeed = (): Seed => {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(`E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`)
  }
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
  if (!seed.woCollatedWorkOrderId) {
    throw new Error("E2E seed missing the #2264 work-order fixture — re-run the seed.")
  }
  return seed
}

/** The source marker: which table answered this order. */
const expectServedBy = (order: any) => {
  if (FROM_WORK_ORDER) expect(order.sales_channel_id, "flag on: served by work_order").toBeNull()
  else expect(order.sales_channel_id, "flag off: served by the core mirror").toBeTruthy()
}

const partnerLogin = async (page: Page, email: string, password: string) => {
  await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForFunction(() => !!localStorage.getItem("partner_ui_auth_token"), {
    timeout: 15_000,
  })
}

const partnerToken = (page: Page) =>
  page.evaluate(() => localStorage.getItem("partner_ui_auth_token"))

const partnerGet = async (page: Page, url: string) => {
  const token = await partnerToken(page)
  return page.request.get(`${BACKEND}${url}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

test.describe(`Partner work orders, reads from ${FROM_WORK_ORDER ? "work_order" : "the core mirror"} @partnerui @workorders`, () => {
  let seed: Seed
  test.beforeAll(() => {
    seed = loadSeed()
  })

  test("partner A: both work orders are listed and served by the selected source", async ({ page }) => {
    await partnerLogin(page, seed.woPartnerAEmail, seed.woPassword)

    for (const [kind, id] of [
      ["inventory", seed.woInventoryWorkOrderId],
      ["design", seed.woDesignWorkOrderId],
    ] as const) {
      const list = await partnerGet(page, `/partners/orders?kind=${kind}&limit=50&fields=%2Bsales_channel_id`)
      expect(list.status()).toBe(200)
      const row = (await list.json()).orders.find((o: any) => o.id === id)
      expect(row, `${kind} work order in the ${kind} list`).toBeTruthy()

      const detail = await partnerGet(page, `/partners/orders/${id}?fields=%2Bsales_channel_id`)
      expect(detail.status()).toBe(200)
      expectServedBy((await detail.json()).order)
    }

    // Partner B's collated order is not partner A's to read.
    const other = await partnerGet(page, `/partners/orders/${seed.woCollatedWorkOrderId}`)
    expect(other.status()).toBe(404)
  })

  test("partner A: the inventory work order page shows its cloth line", async ({ page }) => {
    await partnerLogin(page, seed.woPartnerAEmail, seed.woPassword)
    await page.goto(`${PARTNER_UI}/orders/${seed.woInventoryWorkOrderId}`)
    await expect(page.getByText(seed.woInventoryLineTitle).first()).toBeVisible({ timeout: 30_000 })
  })

  test("partner A: the design list names the one-run work order, and it opens on its next step", async ({ page }) => {
    await partnerLogin(page, seed.woPartnerAEmail, seed.woPassword)
    // The list row's design summary is built from the order's lines — on the
    // work_order path from the typed `items[].design_id`, not the mirror's run
    // link — so the NAME in the row is itself a check of that path.
    await page.goto(`${PARTNER_UI}/orders/design`, { waitUntil: "domcontentloaded" })
    const row = page.getByText(seed.woDesignName).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()
    await page.waitForURL(new RegExp(`/orders/${seed.woDesignWorkOrderId}$`), { timeout: 30_000 })

    // An OFFERED run leads with what to do (#2018)…
    await expect(page.getByRole("button", { name: /accept this run/i })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/producing: 4 pcs/i).first()).toBeVisible()
    // …and Details reveals the job. Expanding is read-only: the run stays
    // offered for the next run and every retry.
    await page.getByRole("button", { name: /^details$/i }).first().click()
    await expect(page.getByRole("heading", { name: /^summary$/i }).first()).toBeVisible({ timeout: 10_000 })
  })

  test("partner B: the collated work order page shows both designs", async ({ page }) => {
    await partnerLogin(page, seed.woPartnerBEmail, seed.woPassword)
    const detail = await partnerGet(page, `/partners/orders/${seed.woCollatedWorkOrderId}?fields=%2Bsales_channel_id`)
    expect(detail.status()).toBe(200)
    expectServedBy((await detail.json()).order)

    await page.goto(`${PARTNER_UI}/orders/${seed.woCollatedWorkOrderId}`)
    for (const name of seed.woCollatedDesignNames) {
      await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 })
    }
  })
})

test.describe(`Admin never opens a work order in the order (sale) screen @workorders`, () => {
  let seed: Seed
  test.beforeAll(() => {
    seed = loadSeed()
  })

  const adminLogin = async (page: Page) => {
    await page.goto("/app/login")
    await page.locator('input[name="email"]').waitFor({ timeout: 60_000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15_000 })
  }

  test("each kind lands on its own page", async ({ page }) => {
    await adminLogin(page)

    await page.goto(`/app/orders/${seed.woInventoryWorkOrderId}`)
    await page.waitForURL(new RegExp(`/app/orders/inventory/${seed.woInventoryOrderId}$`), { timeout: 30_000 })
    await expect(page.getByText(seed.woInventoryLineTitle).first()).toBeVisible({ timeout: 30_000 })

    await page.goto(`/app/orders/${seed.woDesignWorkOrderId}`)
    await page.waitForURL(new RegExp(`/app/production-runs/${seed.woRunId}$`), { timeout: 30_000 })

    await page.goto(`/app/orders/${seed.woCollatedWorkOrderId}`)
    await page.waitForURL(/\/app\/design-work-orders\?id=/, { timeout: 30_000 })
    expect(new URL(page.url()).searchParams.get("id")).toBe(seed.woCollatedWorkOrderId)
    for (const name of seed.woCollatedDesignNames) {
      await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 })
    }
    // The page this lands on never links back into the sale screen.
    await expect(page.getByRole("link", { name: /view order/i })).toHaveCount(0)
  })

  test("Back does not bounce into the sale screen", async ({ page }) => {
    await adminLogin(page)
    await page.goto("/app/orders")
    await page.goto(`/app/orders/${seed.woCollatedWorkOrderId}`)
    await page.waitForURL(/\/app\/design-work-orders\?id=/, { timeout: 30_000 })
    await page.goBack()
    await expect(page).toHaveURL(/\/app\/orders$/, { timeout: 15_000 })
  })
})
