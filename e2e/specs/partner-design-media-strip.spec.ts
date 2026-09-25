import { test, expect, Page } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * The design's reference images moved OUT of their own sidebar card and INTO
 * the header card, beside the design's name.
 *
 * What this proves that a unit test cannot: every claim here is about where
 * things are on a rendered page and whether anything was lost in the move.
 * Nothing in the component tree answers "is the Media card gone", and nothing
 * answers the one that actually costs a partner something —
 * `DesignOwnerActionsSection` returns null for a design a partner was merely
 * ASSIGNED, so folding the strip into that card would have silently taken the
 * reference images away from assigned designers. The strip is rendered
 * separately for them; only a page proves it.
 *
 * The BOM card is asserted PRESENT on purpose. Two cards were discussed for
 * removal and only one went; a spec that checks the deletion without checking
 * the survivor would pass just as happily if both had gone.
 *
 * @partnerui — needs the partner-UI dev server on :5173 and a seeded partner.
 * Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-design-media-strip
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

type Seed = {
  layoutEmail: string
  layoutPassword: string
  layoutDesignId: string
  layoutDesignName: string
  layoutMaterialTitle: string
}

let seed: Seed

test.describe("Partner design detail: media rides in the header @partnerui", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.layoutDesignId || !seed.layoutEmail) {
      throw new Error(
        "E2E seed missing the design-detail layout fixture — re-run the seed."
      )
    }
  })

  const login = async (page: Page) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.layoutEmail)
    await page.locator('input[name="password"]').fill(seed.layoutPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
  }

  const openDesign = async (page: Page) => {
    await login(page)
    await page.goto(`${PARTNER_UI}/designs/${seed.layoutDesignId}`, {
      waitUntil: "domcontentloaded",
    })
    await expect(
      page.getByText(seed.layoutDesignName, { exact: false }).first()
    ).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState("networkidle")
  }

  /**
   * The header card is the one carrying the design's name and its primary
   * action. Anchoring on the ACTION rather than the heading: a heading can be
   * reworded, but "the thumbnails sit in the card you act from" is the claim.
   */
  const headerCard = (page: Page) =>
    page
      .locator("div")
      .filter({ has: page.getByRole("link", { name: /create .*order|new order/i }) })
      .last()

  test("the thumbnails are inside the header card, not a card of their own", async ({
    page,
  }) => {
    await openDesign(page)

    // 1. The strip rendered, with real images.
    const thumbs = page.locator('a[href$="media-preview"] img')
    await expect(thumbs.first()).toBeVisible()
    expect(await thumbs.count()).toBeGreaterThan(0)

    // 2. …in the header card, above every other section.
    const firstThumb = thumbs.first()
    const manage = page.getByRole("link", { name: /manage|add media/i }).first()
    await expect(manage).toBeVisible()

    const thumbBox = await firstThumb.boundingBox()
    const generalHeading = page
      .getByRole("heading", { name: /^general$/i })
      .first()
    const generalBox = await generalHeading.boundingBox()
    expect(thumbBox).not.toBeNull()
    expect(generalBox).not.toBeNull()
    // Above "General" — i.e. in the header, not further down the page where
    // the old sidebar card sat.
    expect(thumbBox!.y).toBeLessThan(generalBox!.y)

    // 3. The standalone Media CARD is gone. Its heading was the only "Media"
    //    heading on the page; the strip carries no heading at all.
    await expect(
      page.getByRole("heading", { name: /^media$/i })
    ).toHaveCount(0)

    // 4. …and the Materials/BOM card is still here, with its material.
    await expect(
      page.getByText(seed.layoutMaterialTitle, { exact: false }).first()
    ).toBeVisible()
  })

  test("the strip survives at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)

    const thumbs = page.locator('a[href$="media-preview"] img')
    await expect(thumbs.first()).toBeVisible()

    // Still in the header on a phone, where the sections stack and "further
    // down the page" costs the most. Asserted here as well as at desktop width
    // deliberately: without it this test passes against the OLD layout too,
    // and a test that cannot tell the two apart is not evidence about either.
    const thumbBox = await thumbs.first().boundingBox()
    const generalBox = await page
      .getByRole("heading", { name: /^general$/i })
      .first()
      .boundingBox()
    expect(thumbBox!.y).toBeLessThan(generalBox!.y)

    // Nothing in the strip may push the page into a horizontal scroll — the
    // thumbs wrap. This is the assertion the old card never had to make,
    // because a full-width grid cannot overflow the way a flex row can.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    expect(overflows).toBe(false)
  })
})
