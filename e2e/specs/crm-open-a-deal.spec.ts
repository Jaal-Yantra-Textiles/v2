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
    await page.waitForURL(/\/app\/crm\/pipeline/, { timeout: 20000 })
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
     * field's own trigger. Anchoring on the name anywhere on the page would
     * match the contact heading behind the modal and pass with the field left
     * on "Nobody yet".
     */
    const contactField = page
      .locator("form")
      .getByRole("combobox")
      .filter({ hasText: `${contactName} Buyer` })
    await expect(contactField).toBeVisible({ timeout: 15000 })
  })

})
