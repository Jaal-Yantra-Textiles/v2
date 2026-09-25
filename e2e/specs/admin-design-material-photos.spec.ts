import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * A design's materials, on the admin design page, with their photographs.
 *
 * 🔑 Why this file exists, and why it points at the GRAPH.
 *
 * The obvious place to look is `design-inventory-section.tsx`, a summary card
 * with an "Inventory" heading. It is imported by nothing: #1847 deliberately
 * removed it from the design page once the graph's `inventory` node listed the
 * same items, unlinked them, and opened the same drawer. Editing that file
 * changes what the founder sees by exactly nothing — which is how this spec
 * started life asserting against a page that had no such card, and failing for
 * a reason that had nothing to do with photographs.
 *
 * So the surface is the graph WORKSPACE's inventory list — `NodeItemList`, the
 * one place that renders a row per member with its removal. The claim is narrow:
 * the row that used to offer a title and an opaque id now leads with the
 * material's picture.
 *
 * ⚠️ NOT the inline panel on the design page itself. That panel lists the node's
 * key/value PROPS, not its items, and still shows no picture — a separate change
 * if it is wanted.
 *
 * The fixture's media is in the canonical `{ files: [...] }` prod shape — the
 * one a naive read misses. A bare array would prove the layout and nothing
 * about whether it can read production.
 */
test.describe("Admin design materials: the row shows the fabric", () => {
  let seed: {
    email: string
    password: string
    layoutDesignId: string
    layoutMaterialTitle: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.layoutDesignId || !seed.layoutMaterialTitle) {
      throw new Error(
        "E2E seed missing the design-detail layout fixture — re-run the seed."
      )
    }
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  /** Open the design's graph workspace and select its inventory node. */
  const openInventoryNode = async (page: any) => {
    await login(page)
    await page.goto(`/app/designs/${seed.layoutDesignId}`)

    await page.getByRole("link", { name: /open workspace/i }).click()
    await page.waitForLoadState("networkidle")

    /**
     * The graph node BUTTON, not any text reading "inventory" — the admin's
     * left nav carries an Inventory link, and matching that navigates away to
     * the global inventory list. The first attempt at this spec did exactly
     * that and then failed on a page it had asked for.
     */
    const node = page
      .getByRole("button")
      .filter({ hasText: /^inventory/i })
      .first()
    await expect(node).toBeVisible({ timeout: 30000 })
    await node.click()

    await expect(
      page.getByText(seed.layoutMaterialTitle, { exact: false }).first()
    ).toBeVisible({ timeout: 15000 })
  }

  test("the linked material's row leads with its photo", async ({ page }) => {
    await openInventoryNode(page)

    /**
     * `img[alt="<title>"]` is exactly what the row renders. A row with no
     * media renders no <img> at all — it does not fall back to a placeholder
     * box — so this fails rather than passes when the media goes unread.
     */
    const photo = page.locator(`img[alt="${seed.layoutMaterialTitle}"]`).first()
    await expect(photo).toBeVisible()

    /**
     * The picture LEADS the row — it is what the eye reaches first, which is
     * the whole point of putting it there.
     *
     * 🔴 Asserted as DOM order, not as `photoBox.x < nameBox.x`. That earlier
     * form compared the bounding boxes of two independently-located elements
     * and went FLAKY on CI: one attempt measured the photo 6px to the right of
     * the name (855.66 vs 849.41) and passed on retry, because the name
     * locator had resolved to a wrapper rather than the title itself. A test
     * that passes on the second go is not evidence, it is noise on main.
     *
     * Document order cannot drift with the viewport, the font or the scroll
     * position, and it is the real claim: the image is the row's first child,
     * and the name is in the same row.
     */
    const leads = await photo.evaluate(
      (img) => img.parentElement?.firstElementChild === img
    )
    expect(leads).toBe(true)

    const nameInSameRow = await photo.evaluate(
      (img, title) => (img.parentElement?.textContent ?? "").includes(title),
      seed.layoutMaterialTitle
    )
    expect(nameInSameRow).toBe(true)
  })
})
