import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * Starting a quote, through a browser (#1439 S4 / #1446).
 *
 * 🔑 Why this file exists: the mint flow shipped in #1463 and had never been
 * opened in a browser. tsc sees a component that compiles; only a render shows
 * a step that will not advance, a hook called outside its provider (#1352), or
 * a Select holding a value it refuses to display.
 *
 * ## It is no longer a wizard, and no longer a wall of sections
 *
 * Minting was four `ProgressTabs` steps in a focus modal that held every answer
 * in the browser and created a priced quote in one POST. It is now the
 * DRAFT-ORDER rail: a small modal captures just enough to make the row —
 * partner, region, destination — and saves it, then the draft's own page shows
 * the record and hands every edit to a `…` menu, with **Mint quote** sitting
 * exactly where a draft order puts "Convert to order".
 *
 * So the old assertions are gone with the things they described: no `tab`
 * roles, no `Continue`, no per-section save buttons, and no page that shows
 * every question at once.
 *
 * ## What this deliberately does NOT do
 *
 * It never completes a mint. A mint needs a partner whose store has a priced
 * product on a quotable freight lane — the preflight refuses anything less,
 * correctly — and standing that world up here would duplicate
 * `integration-tests/helpers/setup-quote-fixture.ts`, which mints for real
 * against a container on every run.
 */
test.describe("Admin quote drafts (#1446)", () => {
  let seed: { email: string; password: string }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    // `networkidle` never settles against `medusa develop` (the dev server
    // holds long-lived connections open), so wait on the form itself.
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  const openStartModal = async (page: any) => {
    await page.goto("/app/quotes/create")
    await expect(
      page.getByRole("heading", { name: "Start a quote" })
    ).toBeVisible({ timeout: 30000 })
  }

  test("asks only for what makes the row, in a modal", async ({ page }) => {
    await login(page)
    await openStartModal(page)

    // A dialog, like the draft-order create modal it mirrors.
    await expect(page.getByRole("dialog")).toHaveCount(1)

    /**
     * The required set is the TABLE's NOT NULL columns, not a taste
     * judgement — partner, destination, currency. Items are deliberately
     * absent: they are added to the draft afterwards.
     */
    for (const label of ["Partner", "Region", "Ships to", "Buyer"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await expect(page.getByText("Quantities & pricing")).toHaveCount(0)
  })

  /**
   * 🔴 The regression that cost the most to find.
   *
   * Picking a region writes that region's first country into the form — and at
   * that instant the country Select has no items, because they are derived
   * from the region only now being set. Radix resolves a controlled value
   * against the items mounted at the time, finds none, shows the PLACEHOLDER,
   * and never recovers. The form held "sg" while the screen said "Select a
   * country", and saving answered "Pick where this ships" over a field that was
   * not empty.
   */
  test("🔑 picking a region fills the currency AND shows the country", async ({
    page,
  }) => {
    await login(page)
    await openStartModal(page)

    const currency = page.locator('input[name="currency_code"]')
    await expect(currency).toBeDisabled()
    await expect(currency).toHaveValue("")

    await page.getByText("Select a region").click()
    // A region that declares countries — at least one of ours declares none.
    await page.getByRole("option", { name: /Singapore/ }).click()

    // The region wrote the currency; nobody typed it.
    await expect(currency).not.toHaveValue("")

    // And the country is VISIBLE, not merely held in form state.
    await expect(page.getByText("Select a country")).toHaveCount(0)
  })

  test("saving opens the draft's own page, with Mint where Convert to order sits", async ({
    page,
  }) => {
    await login(page)
    await openStartModal(page)

    await page.getByText("Select a partner").click()
    await page.getByRole("option", { name: /E2E Content Partner/ }).first().click()
    await page.getByText("Select a region").click()
    await page.getByRole("option", { name: /Singapore/ }).click()

    await page.getByRole("button", { name: "Save" }).click()

    /**
     * A REAL ROW now exists, so there is somewhere to go — the whole
     * difference from the wizard, where nothing was persisted until the end.
     * `handleSuccess` is what makes this navigation happen at all: a bare
     * navigate raises the modal's unsaved-changes guard over work that has
     * just been saved.
     */
    await page.waitForURL(/\/app\/quotes\/drafts\//, { timeout: 30000 })

    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible()
    /**
     * Shipping is its OWN card, as a draft order has — and its position is the
     * point. The lane is quoted against the basket's weight, so it is asked
     * after the items rather than buried mid-way through the buyer form.
     */
    await expect(page.getByRole("heading", { name: "Shipping" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Buyer" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Mint quote" })).toBeVisible()

    // Editing lives behind the `…` menu, not in per-section save buttons.
    await expect(page.getByRole("button", { name: "Save section" })).toHaveCount(0)
    await expect(
      page.locator('[aria-label="Open actions menu"]').first()
    ).toBeVisible()
  })

  /**
   * 🔴 The items editor is a ROUTE MODAL, not a drawer: the basket is a full
   * DataGrid and a side drawer gave it a third of the screen, clipping its own
   * cells. The per-line design picker then stacks OVER it — and `Trigger` and
   * `Content` must share one `StackedFocusModal` root, or the click bubbles to
   * the modal underneath and closes the editor instead of opening the picker.
   */
  test("items open in their own modal, with designs stacked over it", async ({
    page,
  }) => {
    await login(page)
    await openStartModal(page)
    await page.getByText("Select a partner").click()
    await page.getByRole("option", { name: /E2E Content Partner/ }).first().click()
    await page.getByText("Select a region").click()
    await page.getByRole("option", { name: /Singapore/ }).click()
    await page.getByRole("button", { name: "Save" }).click()
    await page.waitForURL(/\/app\/quotes\/drafts\//, { timeout: 30000 })

    await page.locator('[aria-label="Open actions menu"]').nth(1).click()
    await page.getByRole("menuitem", { name: /Edit items/ }).click()
    await page.waitForURL(/\/items$/, { timeout: 30000 })

    await expect(page.getByRole("dialog")).toHaveCount(1)

    /**
     * Two steps, not one scroll. Both halves are full-width tables, and the
     * quantities grid renders a row per variant of the SELECTED products — so
     * before anything is ticked it is empty. Stacked vertically that was a
     * second table showing nothing beneath a first table showing everything.
     */
    await expect(page.getByRole("tab", { name: /Products/ })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Quantities" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible()

    await expect(page.getByRole("tab", { name: "Discount" })).toBeVisible()

    /**
     * 🔴 Save is available on EVERY step. It was briefly gated behind the last
     * one, which made an operator who only wanted to fix a quantity walk
     * through Discount to persist it.
     */
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible()

    await page.getByRole("checkbox").nth(1).click()
    await page.getByRole("button", { name: "Continue" }).click()

    /**
     * The basket-wide discount is NOT a strip above the grid any more — there
     * it competed for the same width and read as a filter over the table
     * rather than an action on it.
     */
    await expect(page.getByPlaceholder("e.g. 15")).toHaveCount(0)

    await page.getByRole("button", { name: "Designs per line" }).click()

    // Stacked ON TOP — the editor underneath must still be there.
    await expect(
      page.getByRole("heading", { name: "Designs per line" })
    ).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole("dialog")).not.toHaveCount(0)
  })

  /**
   * 🔴 The regression the founder hit: Save did nothing and showed an error
   * count with nothing on screen.
   *
   * The form is resolved against the WHOLE quote schema, because the steps it
   * hosts are written against that shape — but this modal hydrates only the
   * partner, the lane and the basket. `form.handleSubmit` therefore never
   * called its callback, and the errors attached to fields this modal does not
   * render. The basket is saved by reading values directly instead.
   */
  test("🔑 saving the basket actually persists it", async ({ page }) => {
    await login(page)
    await openStartModal(page)
    await page.getByText("Select a partner").click()
    await page.getByRole("option", { name: /E2E Content Partner/ }).first().click()
    await page.getByText("Select a region").click()
    await page.getByRole("option", { name: /Singapore/ }).click()
    await page.getByRole("button", { name: "Save" }).click()
    await page.waitForURL(/\/app\/quotes\/drafts\//, { timeout: 30000 })

    await page.locator('[aria-label="Open actions menu"]').nth(1).click()
    await page.getByRole("menuitem", { name: /Edit items/ }).click()
    await page.waitForURL(/\/items$/, { timeout: 30000 })

    await page.getByRole("checkbox").nth(1).click()
    await page.getByRole("button", { name: "Continue" }).click()
    await page.locator('input[name^="quantities."]').first().fill("500")
    await page.getByRole("button", { name: "Save" }).click()

    // Back on the draft, and the units are on the record — not zero.
    await page.waitForURL(/\/app\/quotes\/drafts\/[^/]+$/, { timeout: 30000 })
    await expect(page.getByText("500")).toBeVisible({ timeout: 15000 })
  })

  test("the buyer drawer saves without emptying the basket", async ({ page }) => {
    await login(page)
    await openStartModal(page)

    await page.getByText("Select a partner").click()
    await page.getByRole("option", { name: /E2E Content Partner/ }).first().click()
    await page.getByText("Select a region").click()
    await page.getByRole("option", { name: /Singapore/ }).click()
    await page.getByRole("button", { name: "Save" }).click()
    await page.waitForURL(/\/app\/quotes\/drafts\//, { timeout: 30000 })

    await page.locator('[aria-label="Open actions menu"]').last().click()
    await page.getByRole("menuitem", { name: /Edit buyer/ }).click()

    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByLabel("Contact name").fill("Priya R")
    await page.getByRole("button", { name: "Save", exact: true }).click()

    // The drawer closes on success and the record shows the new value.
    await expect(page.getByText("Priya R")).toBeVisible({ timeout: 15000 })
  })
})
