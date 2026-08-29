import { test, expect, request as pwRequest } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const BASE = "http://localhost:9000"

/**
 * #1551 — the CRM People list can be asked "what came in recently".
 *
 * 🔴 It could not be asked at all. The table had no date column, `useDataTable`
 * was given no sorting state, and the query sent no `order` — so 234 contacts
 * arrived in whatever order the repository happened to return, and the newest
 * one was not findable. All three ends had to change; a spec that only asserted
 * the route would leave the two that a person actually touches unproven.
 *
 * ⚠️ Fixtures are created through the API rather than the e2e seed, on purpose.
 * The embedded CRM store is a FILE held by a single writer — `medusa exec`
 * cannot open it while `medusa develop` has it — and it is never reset by the
 * snapshot restore, so rows accumulate across runs. Every assertion below is
 * therefore about rows THIS spec created and their order relative to each
 * other, never about a count or an absolute position.
 *
 * 🔴 Created sequentially, never with `Promise.all`: two concurrent creates
 * against the embedded store can be handed the same id, and a spec that then
 * finds one row where it expected two passes vacuously.
 */
test.describe("CRM list ordering (#1551)", () => {
  let seed: { email: string; password: string }
  let token: string
  const stamp = Date.now()
  /** Oldest → newest, which is the order they are created in below. */
  const names = [
    `ZZOldest-${stamp}`,
    `ZZMiddle-${stamp}`,
    `ZZNewest-${stamp}`,
  ]

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

    for (const [i, first_name] of names.entries()) {
      const res = await api.post("/admin/crm/people", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          first_name,
          last_name: "Ordering",
          email: `crm-order-${stamp}-${i}@jyt.test`,
        },
      })
      expect([200, 201]).toContain(res.status())
      // Distinct `created_at` values, or "newest first" has nothing to order.
      // The store stamps to the millisecond and these creates are fast.
      await new Promise((r) => setTimeout(r, 1100))
    }
    await api.dispose()
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    // `networkidle` never settles against `medusa develop` (the dev server holds
    // long-lived connections open), so wait on the form itself.
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  /**
   * Where each of this spec's contacts sits in the rendered table, top to
   * bottom. Position relative to EACH OTHER is the only claim that survives a
   * store which accumulates rows across runs.
   */
  const positions = async (page: any) => {
    const rows = await page.getByRole("row").allInnerTexts()
    return names.map((n) => rows.findIndex((r: string) => r.includes(n)))
  }

  test("orders newest first by default, and renders the date it is sorting by", async ({
    page,
  }) => {
    await login(page)
    await page.goto("/app/crm")
    await expect(page.getByText(names[2])).toBeVisible({ timeout: 20000 })

    // The column that made the question askable. It had been declared on the
    // row type all along and rendered nowhere.
    await expect(
      page.getByRole("columnheader", { name: "Added" })
    ).toBeVisible()

    const [oldest, middle, newest] = await positions(page)
    expect(newest).toBeGreaterThan(-1)
    expect(middle).toBeGreaterThan(-1)
    expect(oldest).toBeGreaterThan(-1)
    // Newest nearest the top. Asserted as three strict inequalities rather than
    // "the first row is X" — other rows exist, and will keep being added.
    expect(newest).toBeLessThan(middle)
    expect(middle).toBeLessThan(oldest)
  })

  test("reverses when asked for oldest first", async ({ page }) => {
    await login(page)
    await page.goto("/app/crm")
    await expect(page.getByText(names[2])).toBeVisible({ timeout: 20000 })

    /**
     * ⚠️ Asserted on the DATES of page one, not on where this spec's three
     * contacts land. They are the newest rows in the store, so ascending pushes
     * them onto the LAST page — and a store that accumulates across runs makes
     * "which page" unknowable. The dates are the sort itself, and they are
     * page-independent.
     */
    const addedDates = async () => {
      const rows = await page.getByRole("row").allInnerTexts()
      return rows
        .slice(1)
        .map((r: string) => {
          const m = r.match(/\d{1,2}\/\d{1,2}\/\d{4}/)
          return m ? new Date(m[0]).getTime() : null
        })
        .filter((d): d is number => d !== null)
    }

    const before = await addedDates()
    expect(before.length).toBeGreaterThan(1)
    // Newest first, by default.
    for (let i = 1; i < before.length; i++) {
      expect(before[i]).toBeLessThanOrEqual(before[i - 1])
    }

    /**
     * The column header IS the sort toggle, and it is the only sorting control
     * on this page with an accessible name — the toolbar's
     * `DataTable.SortingMenu` renders as an unnamed icon button, so it cannot
     * be addressed by role+name at all. Worth fixing; not here.
     */
    await page
      .getByRole("columnheader", { name: "Added" })
      .getByRole("button")
      .click()

    await expect(async () => {
      const after = await addedDates()
      expect(after.length).toBeGreaterThan(1)
      for (let i = 1; i < after.length; i++) {
        expect(after[i]).toBeGreaterThanOrEqual(after[i - 1])
      }
      // The re-fetch genuinely happened: the oldest contact in the store is
      // not the newest one, so page one cannot open on the same date twice.
      expect(after[0]).toBeLessThan(before[0])
    }).toPass({ timeout: 15000 })
  })

  test("the route itself orders, and ignores a field it does not recognise", async () => {
    const api = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    })

    const desc = await api.get("/admin/crm/people?limit=100&order=-created_at")
    expect(desc.status()).toBe(200)
    const descNames = (await desc.json()).crm_people.map(
      (p: any) => p.first_name
    )
    expect(descNames.indexOf(names[2])).toBeLessThan(
      descNames.indexOf(names[0])
    )

    /**
     * 🔴 The reason this PR carries a capabilities handshake. The deployed CRM
     * node reads every unrecognised query param as an equality FILTER, so
     * sending `order` to a node that does not know it returned `count: 0` with
     * an HTTP 200 — an empty People table, no error anywhere. An unknown field
     * must order by nothing, never filter by something.
     */
    const bogus = await api.get("/admin/crm/people?limit=100&order=-nonsense")
    expect(bogus.status()).toBe(200)
    const bogusNames = (await bogus.json()).crm_people.map(
      (p: any) => p.first_name
    )
    for (const n of names) expect(bogusNames).toContain(n)

    await api.dispose()
  })
})
