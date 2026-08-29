import { test, expect, request as pwRequest } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const BASE = "http://localhost:9000"

/**
 * #1552 — a deal can be opened from the product.
 *
 * 🔴 Nothing in the product could create an opportunity. The raw route had no
 * caller, `createOpportunityWorkflow` had none anywhere in `src/`, and prod
 * holds 234 contacts against **0 opportunities** — a pipeline board that could
 * only ever have been empty, drawn as six labelled drop-target columns so it
 * read as a data-loading failure rather than as "you have not opened a deal
 * yet".
 *
 * ⚠️ Fixtures go through the API, not the e2e seed: the embedded CRM store is a
 * single-writer FILE that `medusa exec` cannot open while `medusa develop`
 * holds it, and the snapshot restore never resets it. So every assertion is
 * about a deal THIS spec opened, never about a count.
 */
test.describe("Open a CRM deal (#1552)", () => {
  let seed: { email: string; password: string }
  let token: string
  let contactName: string
  let contactId: string
  const stamp = Date.now()
  /**
   * ⚠️ Tracked so afterAll can remove them. The CRM store is a FILE that no
   * snapshot restore resets, so contacts left behind here are permanent — and
   * a hundred of them push every OTHER spec's fixtures off the first page of
   * `/admin/crm/people`, which is what broke `crm-list-ordering`'s
   * route-ordering case on the run that first added them.
   */
  const fillerIds: string[] = []

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

    contactName = `DealContact-${stamp}`
    const person = await api.post("/admin/crm/people", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        first_name: contactName,
        last_name: "Buyer",
        email: `deal-${stamp}@jyt.test`,
      },
    })
    expect([200, 201]).toContain(person.status())
    contactId = (await person.json()).crm_person.id
    await api.dispose()
  })

  test.afterAll(async () => {
    if (!fillerIds.length) return
    const api = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    })
    for (const id of fillerIds) {
      await api.delete(`/admin/crm/people/${id}`)
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

  test("the board says so honestly when there are no deals", async ({
    page,
  }) => {
    const api = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    })
    const res = await api.get("/admin/crm/opportunities?limit=1")
    const count = (await res.json()).count
    await api.dispose()

    /**
     * 🔴 Skipped LOUDLY rather than asserted around, when the store already
     * holds deals. The embedded CRM store is never reset, so a developer's
     * machine accumulates them — and an empty-state case rewritten to pass
     * against a non-empty board is a check that never ran reading as a pass.
     * On CI the database is fresh and prod's own count is 0, which is the
     * condition this case exists for.
     *
     * 🔴 Declared FIRST on purpose. Playwright runs a file in declaration
     * order, and the case below opens a deal — so as the last case this one
     * skipped on every run, CI included. A check that can never run reads as
     * a pass.
     */
    test.skip(
      count > 0,
      `store already holds ${count} deal(s); the empty state is only reachable on a fresh store`
    )

    await login(page)
    await page.goto("/app/crm/pipeline")

    await expect(page.getByText("No deals are open yet.")).toBeVisible({
      timeout: 20000,
    })
    await expect(
      page.getByRole("link", { name: "Open the first deal" })
    ).toBeVisible()
  })

  test("opens a deal from the board, and it lands on the board", async ({
    page,
  }) => {
    await login(page)
    await page.goto("/app/crm/pipeline")

    // The action that makes the board possible at all.
    await page
      .getByRole("link", { name: /New deal|Open the first deal/ })
      .first()
      .click()
    await expect(page.getByRole("heading", { name: "Open a deal" })).toBeVisible(
      { timeout: 15000 }
    )

    const title = `E2E Deal ${stamp}`
    await page.getByLabel("Title").fill(title)
    await page.getByLabel("Amount").fill("125000")

    await page.getByRole("button", { name: "Open deal" }).click()

    /**
     * Back on the board WITH the deal on it — not merely a 201. The route now
     * goes through `createOpportunityWorkflow` rather than writing straight to
     * the service, and a workflow whose side effects fail can still leave the
     * caller a created row; the board is where that shows.
     */
    await page.waitForURL(/\/app\/crm\/pipeline$/, { timeout: 20000 })
    await expect(page.getByText(title)).toBeVisible({ timeout: 20000 })
  })

  test("carries the contact in from their page, so the deal is not owned by nobody", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/crm/${contactId}`)
    await expect(
      page.getByRole("heading", { name: `${contactName} Buyer` })
    ).toBeVisible({ timeout: 20000 })

    /**
     * The thought "this is a real deal" happens while looking at a CONTACT, not
     * at a board. The action lives here too, and must arrive with the contact
     * already filled in — an id typed by hand is how a deal ends up owned by
     * nobody, which the board then renders as a bare ULID.
     */
    await page.getByRole("link", { name: "Open a deal" }).click()
    await expect(page.getByRole("heading", { name: "Open a deal" })).toBeVisible(
      { timeout: 15000 }
    )

    /**
     * Pre-SELECTED, not merely present in the picker — asserted on the Contact
     * field itself. Anchoring on the name anywhere on the page would match the
     * contact heading behind the modal and pass with the field left empty.
     */
    /**
     * ⚠️ Blur first, and assert the popover is shut. The Combobox renders its
     * option list INSIDE this wrapper, so a wrapper that merely "contains the
     * name" may just be showing an open dropdown with that contact somewhere
     * in it — which is a different claim from the field being pre-selected,
     * and passes in cases where the prefill did nothing. (The negative control
     * for this file showed exactly that text: every option, concatenated.)
     */
    await page.getByLabel("Title").click()
    await expect(page.getByRole("option")).toHaveCount(0)
    await expect(
      page.getByTestId("crm-opportunity-contact")
    ).toContainText(`${contactName} Buyer`, { timeout: 15000 })
  })

  /**
   * 🔴 The case above passes on a near-empty store no matter what the code
   * does, because one seeded contact is always inside the first page. THIS is
   * the case that reproduces what was reported from production.
   *
   * `/admin/crm/people` clamps `limit` to 100 and does not complain:
   *
   *   const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100)
   *
   * Both CRM screens asked for `limit: 500` and believed they had everything.
   * With 234 contacts in production that meant the picker held the first 100,
   * and a contact past that point could not be chosen — while arriving from
   * their page prefilled an id with no matching option, which renders as an
   * empty field. Verified against production: contact `crmp_2e6be87e006f` is
   * not in the first 100 of 234, and the deal opened for them stored the
   * owner correctly while the board showed no contact at all.
   */
  test("offers EVERY contact, not the first hundred", async ({ page }) => {
    const api = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    })

    // Push the store past one page, so the assertion below is not vacuous.
    // Bounded: only tops up to the threshold, and the store never resets.
    const before = await api.get("/admin/crm/people?limit=1")
    let total = (await before.json()).count
    for (let i = total; i < 105; i++) {
      const res = await api.post("/admin/crm/people", {
        data: {
          first_name: `Filler-${stamp}-${i}`,
          last_name: "Contact",
          email: `filler-${stamp}-${i}@jyt.test`,
        },
      })
      expect([200, 201]).toContain(res.status())
      fillerIds.push((await res.json()).crm_person.id)
      total++
    }
    expect(total).toBeGreaterThan(100)

    await login(page)
    await page.goto("/app/crm/pipeline/create")
    await expect(page.getByRole("heading", { name: "Open a deal" })).toBeVisible(
      { timeout: 20000 }
    )

    const contact = page.getByTestId("crm-opportunity-contact")
    await contact.getByRole("combobox").click()

    /**
     * Every contact, counted — not "the one I seeded is present". Presence
     * alone passes on a truncated list whenever the fixture lands early; the
     * count is what the truncation actually changes (100 vs 105+).
     */
    await expect
      .poll(async () => await page.getByRole("option").count(), {
        timeout: 20000,
      })
      .toBe(total)

    // Searchable, which a 234-row dropdown has to be to be usable at all.
    await contact.getByRole("combobox").fill(contactName)
    await expect(page.getByRole("option")).toHaveCount(1)
    await page.getByRole("option").first().click()

    const title = `E2E Deal Search ${stamp}`
    await page.getByLabel("Title").fill(title)
    await page.getByRole("button", { name: "Open deal" }).click()

    /**
     * 🔴 Anchored to the END of the path. `/\/app\/crm\/pipeline/` also
     * matches `/app/crm/pipeline/create`, which is where this click STARTS —
     * so it returns instantly whether or not the deal was ever created, and
     * the API read below then races the POST it is supposed to be checking.
     * That is precisely how this case failed on its first run while the
     * feature underneath it worked.
     */
    await page.waitForURL(/\/app\/crm\/pipeline$/, { timeout: 20000 })
    await expect(page.getByText(title)).toBeVisible({ timeout: 20000 })

    /**
     * The reported symptom was "no contact is associated to it", so assert on
     * the STORED record, not on the card. The board rendering the contact and
     * the deal carrying one are different claims, and it was the rendering
     * that failed in production.
     */
    const opps = await api.get("/admin/crm/opportunities?limit=100")
    const created = (await opps.json()).crm_opportunities.find(
      (o: any) => o.title === title
    )
    expect(created).toBeTruthy()
    expect(created.owner_person_id).toBe(contactId)
    await api.dispose()

    // ...and the board NAMES them. This is the half that actually broke in
    // production: the card only renders its contact line when the id resolves
    // through the (truncated) people list, so a deal carrying a contact past
    // row 100 rendered identically to one with no contact at all.
    // Anchored on the CARD, not on any div containing the title — the success
    // toast carries the title too, and `.last()` over bare divs picked the
    // toast, which passes or fails for reasons that have nothing to do with
    // the board.
    const card = page
      .getByTestId("crm-deal-card")
      .filter({ hasText: title })
    await expect(card).toContainText(`${contactName} Buyer`)
  })

})
