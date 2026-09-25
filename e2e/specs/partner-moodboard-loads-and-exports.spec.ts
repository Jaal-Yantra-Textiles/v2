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

  /** Surface the page's own errors — a crashed route otherwise reads as a missing element. */
  const watchForCrash = (page: Page) => {
    const errs: string[] = []
    page.on("pageerror", (e) => errs.push(String(e.stack || e).split("\n").slice(0, 3).join(" | ")))
    return errs
  }

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
    const pageErrors = watchForCrash(page)
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
    if (pageErrors.length) {
      throw new Error("the page crashed before Layers could be opened:\n" + pageErrors.join("\n"))
    }
    await page.getByRole("button", { name: /^layers$/i }).click()
    await expect(page.getByText(/contents/i).first()).toBeVisible({
      timeout: 15_000,
    })

    // And Excalidraw's own verdict on the scene, which is what the export path
    // consults: it must not consider the canvas empty.
    expect(errors.join(" ")).not.toContain("Cannot export empty canvas")
  })

  /**
   * 🔴 An edit made on the canvas can be SAVED, and it persists.
   *
   * The scene-loading rework (#2227) pushes the board onto the canvas
   * imperatively, which is exactly the kind of change that can break saving
   * without breaking rendering — the board would look right and the partner's
   * work would go nowhere. Asserted on the ROW through a second request, never
   * on the toast or the button.
   *
   * It also asserts what the button SAYS, which #2231 fixed. This used to be
   * excluded on purpose: a programmatic load fires Excalidraw's `onChange`
   * asynchronously and re-marked the board dirty, so Save read "Save" on a
   * board nobody had touched and re-lit itself after every successful save.
   * Dirtiness is now derived from a scene signature rather than a flag, so the
   * three states below are real and are locked here.
   */
  test("an edit drawn on the canvas can be saved, and it persists", async ({
    page,
    baseURL,
  }) => {
    const api = await pwRequest.newContext({ baseURL })
    const auth = await api.post("/auth/partner/emailpass", {
      data: { email: seed.layoutEmail, password: seed.layoutPassword },
    })
    const token = (await auth.json()).token
    const h = { headers: { authorization: `Bearer ${token}` } }
    const count = async () => {
      const r = await api.get(`/partners/designs/${seed.layoutDesignId}/moodboards`, h)
      return ((await r.json()).own?.scene?.elements ?? []).length
    }

    const before = await count()
    expect(before).toBeGreaterThan(0)

    await openMoodboard(page)

    const save = page.getByRole("button", { name: /^save$|^saved$/i }).first()

    /**
     * #2231 — a board nobody has touched is SAVED, and stays that way while the
     * editor finishes its own writes. The wait is deliberate: the defect was
     * that the scene push, the scroll-to-fit and the image inlining each fired
     * `onChange` a tick later and lit the button, so an assertion taken
     * immediately would have passed on the broken code too.
     */
    await expect(save).toHaveText(/^saved$/i, { timeout: 15_000 })
    await expect(save).toBeDisabled()
    await page.waitForTimeout(2_000)
    await expect(save).toBeDisabled()

    // Draw a rectangle: pick the tool, drag on empty canvas.
    await page.mouse.click(400, 250)
    await page.keyboard.press("r")
    await page.mouse.move(300, 600)
    await page.mouse.down()
    await page.mouse.move(520, 720, { steps: 12 })
    await page.mouse.up()

    // A real edit lights it up.
    await expect(save).toBeEnabled({ timeout: 10_000 })
    await expect(save).toHaveText(/^save$/i)
    await save.click()

    // It persisted — asserted on the ROW, not on the toast or the button.
    await expect.poll(async () => await count(), { timeout: 20_000 }).toBe(before + 1)

    // #2231 — and it goes back to "Saved" and STAYS there. The save invalidates
    // the boards query, whose refetch re-runs the scroll-to-fit; that used to
    // re-arm the button, so the partner could never tell their work was in.
    await expect(save).toHaveText(/^saved$/i, { timeout: 15_000 })
    await page.waitForTimeout(2_000)
    await expect(save).toBeDisabled()

    await api.dispose()
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
