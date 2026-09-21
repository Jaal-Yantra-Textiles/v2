import { test, expect, Page, request as pwRequest } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * The moodboard shows its board, and the export dialog can be used.
 *
 * 🔴 Two defects, one symptom: "the moodboard cannot be exported".
 *
 * 1. THE BOARD NEVER REACHED THE CANVAS ON A FRESH LOAD. `initialData` is read
 *    once, at mount, and the editor was gated on the DESIGN query while the
 *    scene comes from the BOARDS query — so Excalidraw mounted empty and never
 *    saw the board. The tell was easy to misread as a rendering bug: the canvas
 *    sat at 30% zoom, having fitted to the elements' real extent, with nothing
 *    drawn, and Excalidraw answered "Cannot export empty canvas". There was
 *    nothing to export because there was nothing on the canvas.
 *
 * 2. THE EXPORT DIALOG WAS UNCLICKABLE. Excalidraw portals its dialogs to
 *    `document.body`, outside our RouteFocusModal, and Radix sets
 *    `pointer-events: none` on the body while a modal is open. Every ancestor
 *    of the PNG button inherited it, so `elementFromPoint` over the button
 *    returned the CANVAS behind it and every click went to the drawing surface.
 *
 * Neither is visible to a unit test: one is a mount-order race between two
 * queries, the other is inherited CSS from a portal in another subtree.
 *
 * @partnerui — needs the partner-UI dev server on :5173.
 * Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-moodboard-loads-and-exports
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

type Seed = {
  layoutEmail: string
  layoutPassword: string
  layoutDesignId: string
}

let seed: Seed

test.describe("Partner moodboard: it loads, and it can be exported @partnerui", () => {
  test.beforeAll(async ({ baseURL }) => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.layoutDesignId || !seed.layoutEmail) {
      throw new Error("E2E seed missing the layout fixture — re-run the seed.")
    }

    /**
     * Give the design a brief and build a board through the API, so the page
     * under test is opened FRESH against a board that already exists. Doing it
     * in the browser would hide the bug entirely: a scene put on the canvas by
     * `loadScene` during the session is exactly the path that always worked.
     */
    const api = await pwRequest.newContext({ baseURL })
    const auth = await api.post("/auth/partner/emailpass", {
      data: { email: seed.layoutEmail, password: seed.layoutPassword },
    })
    expect(auth.ok()).toBeTruthy()
    const token = (await auth.json()).token
    const h = { headers: { authorization: `Bearer ${token}` } }

    await api.put(`/partners/designs/${seed.layoutDesignId}/brief`, {
      data: { concept_theme: "E2E export fixture" },
      ...h,
    })
    const gen = await api.post(
      `/partners/designs/${seed.layoutDesignId}/moodboard/generate`,
      { data: {}, ...h }
    )
    expect(gen.status()).toBe(200)
    expect(((await gen.json()).moodboard?.elements ?? []).length).toBeGreaterThan(0)
    await api.dispose()
  })

  const openMoodboard = async (page: Page) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.layoutEmail)
    await page.locator('input[name="password"]').fill(seed.layoutPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
    await page.goto(`${PARTNER_UI}/designs/${seed.layoutDesignId}/moodboard`, {
      waitUntil: "domcontentloaded",
    })
    await page.waitForLoadState("networkidle")
    await expect(page.locator(".excalidraw canvas").first()).toBeVisible({
      timeout: 30_000,
    })
  }

  test("🔴 the saved board is ON the canvas after a fresh load", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })

    await openMoodboard(page)

    /**
     * The Layers panel lists frames read from the LIVE Excalidraw API, not from
     * React state — so it answers the only question that matters here: did the
     * scene reach the canvas? A screenshot cannot; React state held the board
     * correctly the whole time the canvas was blank.
     */
    await page.getByRole("button", { name: /^layers$/i }).click()
    await expect(page.getByText(/contents/i).first()).toBeVisible({
      timeout: 15_000,
    })

    // And Excalidraw's own verdict on the scene, which is what the export path
    // consults: it must not consider the canvas empty.
    expect(errors.join(" ")).not.toContain("Cannot export empty canvas")
  })

  test("the export dialog's PNG button is reachable, and the editor survives it", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })

    await openMoodboard(page)

    await page.locator(".excalidraw .dropdown-menu-button").first().click()
    await page.getByText(/export image/i).first().click()

    const png = page.getByText(/^PNG$/i).first()
    await expect(png).toBeVisible({ timeout: 10_000 })

    /**
     * 🔴 Hit-testing, not visibility. The button was always visible and always
     * "enabled" — it was `pointer-events: none`, inherited from the body, and
     * the element at its centre was the canvas behind it.
     */
    const box = (await png.boundingBox())!
    const topMost = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return el ? `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}` : "none"
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    )
    expect(topMost).not.toContain("canvas")

    await png.click({ timeout: 5_000 })

    // Excalidraw had something to export…
    expect(errors.join(" ")).not.toContain("Cannot export empty canvas")

    // …and clicking inside Excalidraw's portal did not dismiss OUR modal, which
    // Radix treats as a click outside its content.
    await expect(
      page.getByRole("button", { name: /^save$|^saved$/i })
    ).toBeVisible()
  })
})
