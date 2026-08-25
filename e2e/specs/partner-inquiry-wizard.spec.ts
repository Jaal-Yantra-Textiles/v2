import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

/**
 * The UI contract for the sourcing wizard (#1531 slice 2).
 *
 * ## Why this file exists
 *
 * `apps/partner-ui` has no CI at all (#1482). Slice 2 shipped to production
 * having been proven only by `tsc --noEmit` and `vite build` — which prove the
 * code compiles and say nothing whatever about whether a partner can answer a
 * question. Every partner-facing failure this repo has had was of that second
 * kind: the quote list shipped twice with no nav pointing at it, and nothing
 * failed either time.
 *
 * So this asserts the CONTRACT, not the implementation:
 *
 *   1. a partner can REACH the wizard from the sidebar, not just by URL;
 *   2. the questions rendered are the ones the inquiry persisted, in order;
 *   3. each question kind renders its own control;
 *   4. a step SAVES before the wizard advances;
 *   5. a submitted verdict survives a reload;
 *   6. a closed inquiry cannot be answered.
 *
 * 🔴 (4) and (5) are the ones worth the whole file. Autosave-then-advance is
 * where a wizard loses work silently: the partner finishes, sees no error, and
 * nothing was kept. That failure has no symptom at all from inside the app.
 *
 * @partnerui — needs the partner-UI dev server, which the e2e config does not
 * boot; skipped on CI, run locally.
 *
 * ⚠️ **Check WHICH checkout is serving that port.** On this machine :5173 has
 * been served by vite from a *different clone of this repo*, so partner-UI
 * specs quietly asserted against another working tree — the fix under test was
 * nowhere in the bundle. `ps -o command= -p $(lsof -ti:5173)` settles it.
 * Point this at the right server with `PARTNER_UI_URL=http://localhost:5174`
 * rather than assuming the default port is yours.
 */

type Seed = {
  inquiryPartnerEmail: string
  inquiryPartnerPassword: string
  inquiryId: string
  inquiryDesignName: string
  inquiryMaterialPrompt: string
  inquiryMeasurementPrompt: string
  inquiryColourPrompt: string
  inquiryPhotoPrompt: string
  inquiryQuestionCount: number
}

const seed: Seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))

/**
 * 🔑 Fail loudly on a seed that predates this fixture rather than passing
 * vacuously against `undefined`. A spec that asserts `toContain(undefined)`
 * finds nothing and reports nothing — the #1495 shape, where a suite stayed
 * green while the thing it certified was impossible.
 */
test.beforeAll(() => {
  expect(
    seed.inquiryId,
    "Seed predates the #1531 inquiry fixture — re-run the e2e seed"
  ).toBeTruthy()
})

const login = async (page: any) => {
  // `networkidle` matters: the submit handler is attached on hydration, and a
  // click that lands before it is silently swallowed.
  await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
  await page.locator('input[name="email"]').fill(seed.inquiryPartnerEmail)
  await page.locator('input[name="password"]').fill(seed.inquiryPartnerPassword)
  await page.locator('button[type="submit"]').click()

  // Wait on the PERSISTED TOKEN, not the URL — a `/\/(?!login)/` match resolves
  // instantly against the "//" in "http://" and races past login.
  await page.waitForFunction(
    () => !!localStorage.getItem("partner_ui_auth_token"),
    { timeout: 15_000 }
  )
}

test.describe("Partner sourcing wizard @partnerui", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  /**
   * 🔴 A route that renders is not a feature.
   *
   * The quote list shipped twice with nothing in the nav pointing at it — the
   * second time because the entry was added to two of the three persona
   * branches in `main-layout.tsx` and missed on the DEFAULT one, i.e. the
   * sidebar most partners actually get. This is the same file and the same
   * three branches.
   */
  test("🔑 the wizard is reachable from the sidebar, not only by URL", async ({
    page,
  }) => {
    // Entered on a concrete route: the partner root renders the app's own 404
    // for a seeded partner that has not been through onboarding, and a spec
    // that starts there fails for reasons unrelated to the nav.
    await page.goto(`${PARTNER_UI}/inquiries`)

    await page.getByRole("link", { name: /^designs$/i }).first().click()
    await expect(
      page.getByRole("link", { name: /what can you make/i }).first()
    ).toBeVisible({ timeout: 15_000 })
  })

  test("the list leads with what is still owed", async ({ page }) => {
    await page.goto(`${PARTNER_UI}/inquiries`)

    await expect(page.getByText(seed.inquiryDesignName)).toBeVisible({
      timeout: 15_000,
    })
    // An un-answered inquiry must SAY it is un-answered. "3 asked, 1 replied"
    // is the fact the empty response row exists to make readable, and it is
    // useless if the partner cannot see which one is theirs to do.
    await expect(page.getByText(/needs your answer/i).first()).toBeVisible()
    await expect(
      page.getByText(new RegExp(`${seed.inquiryQuestionCount}\\s+questions`, "i"))
    ).toBeVisible()
  })

  /**
   * 🔴 The questions must be the PERSISTED ones, in their persisted order.
   *
   * Regenerating them from the design's current spec on read would look
   * identical on a fresh inquiry and be wrong on every older one: a spec moves
   * while sourcing runs, and a wizard that silently rewords itself between
   * being sent and being answered makes "yes we can do that" unreadable,
   * because it no longer says which *that*.
   */
  test("🔴 renders the persisted questions, grouped by their spec category", async ({
    page,
  }) => {
    await page.goto(`${PARTNER_UI}/inquiries/${seed.inquiryId}`)

    for (const step of ["Materials", "Measurements", "Colours", "Show us"]) {
      await expect(
        page.getByRole("tab", { name: new RegExp(`^${step}$`, "i") }).first()
      ).toBeVisible({ timeout: 15_000 })
    }

    // Step one is Materials, and its question is the seeded one verbatim.
    await expect(page.getByText(seed.inquiryMaterialPrompt)).toBeVisible()
  })

  test("each question kind renders its own control", async ({ page }) => {
    await page.goto(`${PARTNER_UI}/inquiries/${seed.inquiryId}`)

    // yes_no — a radio pair, not a free-text box.
    await expect(page.getByLabel(/^yes$/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel(/^no$/i)).toBeVisible()

    await page.getByRole("tab", { name: /^measurements$/i }).click()
    // number — typed, so "90" is a figure we can compare across partners
    // rather than a sentence somebody has to read.
    await expect(
      page.locator('input[type="number"]').first()
    ).toBeVisible({ timeout: 15_000 })

    await page.getByRole("tab", { name: /^colours$/i }).click()
    // colour_select — the DESIGN's own colours, not the 55-value platform
    // palette. A partner must not be shown 55 swatches for a design that uses
    // two.
    await expect(page.getByText("Off White")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Indigo")).toBeVisible()

    await page.getByRole("tab", { name: /^show us$/i }).click()
    await expect(page.getByText(seed.inquiryPhotoPrompt)).toBeVisible({
      timeout: 15_000,
    })
  })

  /**
   * 🔴 THE ONE THAT MATTERS. A step must be written before the wizard moves on.
   *
   * This is answered on a phone at a loom, on a connection that drops. If
   * "Save and continue" advances without persisting, the partner completes a
   * wizard that kept nothing, sees no error, and we read their silence as
   * disinterest. There is no symptom from inside the app — which is why it is
   * asserted against the RELOAD, not against a toast.
   */
  test("🔴 a step is persisted before the wizard advances", async ({ page }) => {
    await page.goto(`${PARTNER_UI}/inquiries/${seed.inquiryId}`)

    await page.getByLabel(/^yes$/i).check()
    const note = `e2e loom note ${Date.now()}`
    await page.getByPlaceholder(/anything worth adding/i).first().fill(note)

    // The request has to actually be observed. Asserting on the UI alone would
    // pass against a client that advanced optimistically and dropped the write.
    const saved = page.waitForResponse(
      (r: any) =>
        r.url().includes(`/partners/inquiries/${seed.inquiryId}/answers`) &&
        r.request().method() === "POST" &&
        r.status() < 400
    )
    await page.getByRole("button", { name: /save and continue/i }).click()
    await saved

    // And it has to come back from the SERVER, not from a cache that never
    // round-tripped.
    await page.reload({ waitUntil: "networkidle" })
    await expect(page.getByLabel(/^yes$/i)).toBeChecked({ timeout: 15_000 })
    await expect(
      page.getByPlaceholder(/anything worth adding/i).first()
    ).toHaveValue(note)
  })

  /**
   * 🔴 A failed save must NOT advance the step.
   *
   * Advancing would render the next step as though the last had been recorded.
   * The partner then finishes a wizard whose earlier answers were never kept —
   * the same silent loss as above, arrived at from the other direction.
   */
  test("🔴 a failed save keeps the partner on the step", async ({ page }) => {
    await page.goto(`${PARTNER_UI}/inquiries/${seed.inquiryId}`)

    await page.route(`**/partners/inquiries/${seed.inquiryId}/answers`, (route: any) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "boom" }),
      })
    )

    await page.getByLabel(/^no$/i).check()
    await page.getByRole("button", { name: /save and continue/i }).click()

    // Still on Materials — the question is still the one we started on.
    await expect(page.getByText(seed.inquiryMaterialPrompt)).toBeVisible({
      timeout: 15_000,
    })
  })

  /**
   * The verdict is the whole point of the inquiry. `with_changes` in
   * particular is the answer a yes/no would have thrown away — "not in that
   * GSM, but I can do 90" is how a design actually develops.
   */
  test("a submitted verdict survives a reload", async ({ page }) => {
    await page.goto(`${PARTNER_UI}/inquiries/${seed.inquiryId}`)

    await page.getByRole("tab", { name: /your answer/i }).click()
    await page.getByLabel(/yes, with changes/i).check()
    await page.getByLabel(/lead time/i).fill("21")

    const submitted = page.waitForResponse(
      (r: any) =>
        r.url().includes(`/partners/inquiries/${seed.inquiryId}/submit`) &&
        r.request().method() === "POST" &&
        r.status() < 400
    )
    await page
      .getByRole("button", { name: /send my answer|update my answer/i })
      .click()
    await submitted

    await page.reload({ waitUntil: "networkidle" })
    await page.getByRole("tab", { name: /your answer/i }).click()
    await expect(page.getByLabel(/yes, with changes/i)).toBeChecked({
      timeout: 15_000,
    })
    await expect(page.getByLabel(/lead time/i)).toHaveValue("21")
  })

  /**
   * 🔴 An uninvited partner must not learn the inquiry EXISTS.
   *
   * The server answers 404 rather than 403 precisely because the existence of
   * an inquiry names a design being sourced, and that is itself the
   * confidential part (#1496). This asserts the UI does not leak it back — a
   * page that renders the title above an error message would undo the whole
   * point of the status code.
   */
  test("🔴 an inquiry this partner was not invited to reveals nothing", async ({
    page,
  }) => {
    await page.goto(`${PARTNER_UI}/inquiries/dinq_not_mine_at_all`)

    await expect(page.getByText(seed.inquiryDesignName)).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: /save and continue/i })
    ).toHaveCount(0)
  })
})
