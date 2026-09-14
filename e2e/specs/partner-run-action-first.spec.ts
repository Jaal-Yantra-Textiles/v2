import { test, expect, Page } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #2018 — the action leads, the detail is revealed as earned.
 *
 * What this proves that a unit test cannot: `deriveRunPhase` is pure and
 * already covered by `apps/partner-ui/src/lib/run-phase.test.ts`, but whether
 * the partner SEES the action before the spec is a question about a rendered
 * page. #2018 is a layout change; only rendering shows it.
 *
 * The fixture is a design work-order in the OFFERED phase — the phase the
 * rework is about. Any later phase reveals everything and proves less.
 *
 * @partnerui — needs the partner-UI dev server on :5173 and a seeded partner.
 * Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-run-action-first
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

type Seed = {
  actionFirstEmail: string
  actionFirstPassword: string
  actionFirstDesignName: string
}

let seed: Seed

test.describe("Partner work-order: the action leads @partnerui", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.actionFirstEmail || !seed.actionFirstDesignName) {
      throw new Error(
        "E2E seed missing the #2018 action-first fixture — re-run the seed."
      )
    }
  })

  const login = async (page: Page) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.actionFirstEmail)
    await page.locator('input[name="password"]').fill(seed.actionFirstPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
  }

  /** Sign in and open the seeded work-order's detail page. */
  const openWorkOrder = async (page: Page) => {
    await login(page)
    await page.goto(`${PARTNER_UI}/orders/design`, {
      waitUntil: "domcontentloaded",
    })
    const row = page
      .getByText(seed.actionFirstDesignName, { exact: false })
      .first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()
    await page.waitForURL(/\/orders\/order_/, { timeout: 30_000 })
    await page.waitForLoadState("networkidle")
  }

  /**
   * The BUTTON, not the heading. The heading names the stage ("Your next
   * step") and could be reworded without changing what the partner can do; the
   * button IS the action.
   */
  const nextAction = (page: Page) =>
    page.getByRole("button", { name: /accept this run/i }).first()

  const detailsToggle = (page: Page) =>
    page.getByRole("button", { name: /^details$/i }).first()

  test("the next action is 'Accept this run', above the job detail", async ({
    page,
  }) => {
    await openWorkOrder(page)

    const action = nextAction(page)
    await expect(action).toBeVisible({ timeout: 20_000 })

    await expect(
      page.getByText(/confirm you'll handle this work/i).first()
    ).toBeVisible()

    // The heart of it: the action must sit physically ABOVE the detail.
    const actionBox = await action.boundingBox()
    const detailsBox = await detailsToggle(page).boundingBox()
    expect(actionBox, "could not measure the action block").not.toBeNull()
    expect(detailsBox, "could not measure the detail block").not.toBeNull()
    expect(
      actionBox!.y,
      `action at y=${actionBox!.y} is not above detail at y=${detailsBox!.y}`
    ).toBeLessThan(detailsBox!.y)
  })

  test("the job detail is hidden while the run is merely offered — and Details reveals it", async ({
    page,
  }) => {
    await openWorkOrder(page)

    /**
     * 🔴 Anchored on the "Summary" heading, which ALWAYS renders for a design
     * work-order. An earlier version of this check looked for "bill of
     * materials" / "size set" — text a bare seeded design never produces — so
     * it passed whether or not the gate worked. A mutation (`revealed={true}`)
     * exposed it: the gate was forced open and the check stayed green.
     * A check that never runs reads as a pass.
     */
    await expect(page.getByRole("heading", { name: /^summary$/i })).toHaveCount(
      0
    )

    // Hidden, not deleted.
    await detailsToggle(page).click()
    await expect(
      page.getByRole("heading", { name: /^summary$/i }).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test("the action is still on the first screen at 400px", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 850 })
    await openWorkOrder(page)

    const action = nextAction(page)
    await expect(action).toBeVisible({ timeout: 20_000 })

    const box = await action.boundingBox()
    expect(box, "no action block at 400px").not.toBeNull()
    expect(
      box!.y,
      `action at y=${box!.y} is below the fold`
    ).toBeLessThanOrEqual(850)
  })
})
