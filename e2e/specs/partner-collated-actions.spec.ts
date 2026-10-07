import { test, expect, type Page } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #2357 — a design work-order with several designs, driven in the partner UI:
 * the "Designs at a glance" panel and the "Actions for all designs" drawer.
 *
 * What only a browser shows: that the panel names each design with the step it
 * owes, that the drawer lists exactly the designs an action covers, that
 * unticking one leaves it out, and that the per-design button acts on THAT
 * design. The grouping rules are unit tested (partner-ui
 * src/lib/collated-actions.test.ts); this proves the page wires them to the
 * right runs — and reads every run back from the API, because a toast that
 * says "done" is not evidence anything persisted.
 *
 * Fixture (e2e-seed.ts `seedCollatedActionsFixture`): its own partner, one
 * collated order of two designs, both OFFERED (sent_to_partner, not accepted).
 *
 * ⚠️ MUTATES its fixture (accepts and starts a run), so it never retries: a
 * retry would open an order the first attempt already moved, and fail for a
 * reason that says nothing about the defect. Read attempt #1. A fresh seed
 * (`pnpm e2e:seed`) makes a fresh order.
 *
 * Also, read-only: the payment request form pre-ticks the runs a completion
 * hands it (`?run_ids=`), using #1571's never-billed `payableRunId`.
 *
 * @partnerui — needs the partner-UI dev server on :5173. Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-collated-actions
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"
const BACKEND = process.env.E2E_BACKEND_URL || `http://localhost:${process.env.E2E_BACKEND_PORT || 9000}`

type Seed = {
  caEmail: string
  caPassword: string
  caWorkOrderId: string
  caDesigns: { name: string; runId: string }[]
  payoutPartnerEmail: string
  payoutPartnerPassword: string
  payableRunId: string
  unpricedRunId: string
}

const loadSeed = (): Seed => {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(`E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`)
  }
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
  if (!seed.caWorkOrderId || seed.caDesigns?.length !== 2) {
    throw new Error("E2E seed missing the #2357 collated-actions fixture — re-run the seed.")
  }
  return seed
}

const login = async (page: Page, email: string, password: string) => {
  await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForFunction(() => !!localStorage.getItem("partner_ui_auth_token"), {
    timeout: 15_000,
  })
}

/** The run as the server holds it — the only proof an action persisted. */
const readRun = async (page: Page, runId: string) => {
  const token = await page.evaluate(() => localStorage.getItem("partner_ui_auth_token"))
  const res = await page.request.get(`${BACKEND}/partners/production-runs/${runId}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.status(), `GET run ${runId}`).toBe(200)
  return (await res.json()).production_run
}

/** One design's row in the at-a-glance panel, by its FULL run id. */
const panelRow = (page: Page, runId: string) => page.locator(`[data-glance-run-id="${runId}"]`)

test.describe("Partner collated order: designs at a glance + all-designs actions @partnerui", () => {
  test.describe.configure({ retries: 0 })

  let seed: Seed
  test.beforeAll(() => {
    seed = loadSeed()
  })

  test("accept one design from the drawer, start it from the panel, the other stays offered", async ({ page }) => {
    const [robe, apron] = seed.caDesigns
    await login(page, seed.caEmail, seed.caPassword)

    // Precondition, from the server: both offered. A re-used seed fails here,
    // naming the fixture instead of a confusing UI assertion further down.
    for (const d of seed.caDesigns) {
      const run = await readRun(page, d.runId)
      expect(run.status, `${d.name} must start offered — re-seed if not`).toBe("sent_to_partner")
    }

    await page.goto(`${PARTNER_UI}/orders/${seed.caWorkOrderId}`)
    await expect(page.getByRole("heading", { name: /designs at a glance/i })).toBeVisible({ timeout: 30_000 })

    // The panel names each design with the one step it owes.
    for (const d of seed.caDesigns) {
      const row = panelRow(page, d.runId)
      await expect(row).toContainText(d.name)
      await expect(row.getByRole("button", { name: /^accept$/i })).toBeVisible()
    }

    // ── Accept all: the drawer lists BOTH, ticked; untick the apron.
    await page.getByRole("button", { name: /accept all \(2\)/i }).click()
    const drawer = page.getByRole("dialog")
    await expect(drawer.getByText(/accept all: which designs\?/i)).toBeVisible()
    const robeBox = drawer.locator(`[data-bulk-run-id="${robe.runId}"]`).getByRole("checkbox")
    const apronBox = drawer.locator(`[data-bulk-run-id="${apron.runId}"]`).getByRole("checkbox")
    await expect(robeBox).toBeChecked()
    await expect(apronBox).toBeChecked()
    await apronBox.click()
    await expect(apronBox).not.toBeChecked()
    await drawer.getByRole("button", { name: /^accept 1$/i }).click()

    // Read back: the robe accepted, the apron untouched.
    await expect
      .poll(async () => (await readRun(page, robe.runId)).accepted_at, { timeout: 20_000 })
      .toBeTruthy()
    expect((await readRun(page, apron.runId)).status, "the unticked design stays offered").toBe("sent_to_partner")

    // The page follows: the robe now owes Start, the apron still owes Accept,
    // and the bar offers one of each.
    await expect(panelRow(page, robe.runId).getByRole("button", { name: /^start$/i })).toBeVisible({ timeout: 20_000 })
    await expect(panelRow(page, apron.runId).getByRole("button", { name: /^accept$/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /accept all \(1\)/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /start all \(1\)/i })).toBeVisible()

    // ── The panel's own button acts on ITS design, after a confirm.
    await panelRow(page, robe.runId).getByRole("button", { name: /^start$/i }).click()
    const confirm = page.getByRole("alertdialog")
    await expect(confirm.getByText(new RegExp(`start ${robe.name}\\?`, "i"))).toBeVisible()
    await confirm.getByRole("button", { name: /^start$/i }).click()

    await expect
      .poll(async () => (await readRun(page, robe.runId)).started_at, { timeout: 20_000 })
      .toBeTruthy()
    expect((await readRun(page, apron.runId)).status, "starting the robe leaves the apron alone").toBe("sent_to_partner")
    await expect(panelRow(page, robe.runId).getByRole("button", { name: /^finish$/i })).toBeVisible({ timeout: 20_000 })
  })

  test("the payment request form pre-ticks the runs a completion hands it", async ({ page }) => {
    test.skip(!seed.payableRunId, "needs #1571's payout fixture")
    await login(page, seed.payoutPartnerEmail, seed.payoutPartnerPassword)
    await page.goto(
      `${PARTNER_UI}/payment-submissions/create?run_ids=${encodeURIComponent(seed.payableRunId)}`,
      { waitUntil: "networkidle" }
    )
    await page.getByTestId("work-filter-runs").click()
    const ticked = page.locator(`[data-run-id="${seed.payableRunId}"]`).getByRole("checkbox")
    await expect(ticked).toBeVisible({ timeout: 30_000 })
    await expect(ticked).toBeChecked()
    // A run the link did not name stays unticked.
    await expect(
      page.locator(`[data-run-id="${seed.unpricedRunId}"]`).getByRole("checkbox")
    ).not.toBeChecked()
  })
})
