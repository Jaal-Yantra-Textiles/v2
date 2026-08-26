import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #1228 — manual reassignment out of `awaiting_reassignment`, driven through
 * the admin UI.
 *
 * #1093 could park a run (reminder cap / partner decline) but nothing moved it
 * back out: the run page rendered a red badge and no actionable control, so a
 * parked run was a dead end even for a retry with the SAME partner. These cases
 * assert the UI half of the fix — the Reassign entry point exists on a parked
 * run, the drawer pre-selects the partner who let it lapse, and completing it
 * leaves the run genuinely dispatchable rather than merely re-labelled.
 */
test.describe("Production run manual reassignment (#1228)", () => {
  let seed: {
    email: string
    password: string
    parkedRunId: string
    parkedRunLapsedPartnerName: string
    parkedRunFreshPartnerName: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.parkedRunId) {
      throw new Error("E2E seed missing parkedRunId — re-run the seed.")
    }
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

  test("surfaces a Reassign action on a parked run and re-sends it to the same partner", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/production-runs/${seed.parkedRunId}`)

    // The parked state is visible…
    await expect(
      page.getByText("awaiting reassignment", { exact: false }).first()
    ).toBeVisible({ timeout: 15000 })

    // …and, unlike before #1228, it is actionable.
    const reassign = page.getByRole("button", { name: "Reassign" })
    await expect(reassign).toBeVisible()
    await reassign.click()

    // The drawer explains WHY the run needs reassigning (the park reason).
    await expect(
      page.getByRole("heading", { name: "Assign partner" })
    ).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText("Machine servicing", { exact: false })
    ).toBeVisible()

    // `?mode=same` pre-selects the partner who let it lapse, so the common case
    // ("just send it to them again") is a single confirm.
    await expect(
      page.getByRole("button", { name: /Re-assign to same partner/i })
    ).toBeEnabled()

    await page
      .getByRole("button", { name: /Re-assign to same partner/i })
      .click()

    // Back on the run page: it is approved, holds the partner again, and — the
    // part that actually matters — Dispatch is offered. An "approved" run whose
    // dispatch cycle wasn't rewound would show no Dispatch button at all.
    await expect(page.getByText("approved", { exact: false }).first()).toBeVisible({
      timeout: 15000,
    })
    await expect(
      page.getByRole("button", { name: /Dispatch to Partner/i })
    ).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole("button", { name: "Reassign" })).toHaveCount(0)
  })

  test("offers a different partner from the overflow menu and records the swap", async ({
    page,
  }) => {
    await login(page)
    // The previous case left the run `approved` and assigned — still a valid
    // reassignment source (a plain correction before the partner accepts).
    await page.goto(`/app/production-runs/${seed.parkedRunId}`)

    /**
     * `exact: true` — Playwright matches an accessible name by SUBSTRING and
     * case-insensitively by default, so `{ name: "Actions" }` also matches the
     * shared ActionMenu's `aria-label="Open actions menu"`. This page carries
     * both that menu and its own `aria-label="Actions"` IconButton, so the
     * query resolved to two elements and Playwright refused in strict mode.
     *
     * 🔑 The page is not at fault and neither is the assertion — two distinct
     * menus on one screen is legitimate. The collision appeared when the shared
     * ActionMenu gained its aria-label in #1488 (836841ffb), which is why a test
     * nobody touched started failing: the DOM this queries changed underneath a
     * selector that was only ever unambiguous by luck.
     */
    await page.getByRole("button", { name: "Actions", exact: true }).click()
    const differentPartner = page.getByText("Assign a different partner")
    await expect(differentPartner).toBeVisible({ timeout: 10000 })
    await differentPartner.click()

    await expect(
      page.getByRole("heading", { name: "Assign partner" })
    ).toBeVisible({ timeout: 10000 })

    // Narrow with the search box first, then pick — this also exercises the
    // filter, which is the only way the picker stays usable at 200 partners.
    await page.getByPlaceholder("Search partners…").fill(
      seed.parkedRunFreshPartnerName
    )
    await page.getByRole("combobox").click()
    await page
      .getByRole("option", { name: seed.parkedRunFreshPartnerName })
      .first()
      .click()

    const confirm = page.getByRole("button", { name: /^Assign partner$/ })
    await expect(confirm).toBeEnabled()
    await confirm.click()

    // The run stays dispatchable under its new partner.
    await expect(
      page.getByRole("button", { name: /Dispatch to Partner/i })
    ).toBeVisible({ timeout: 15000 })
  })
})
