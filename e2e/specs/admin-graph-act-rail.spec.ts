import fs from "fs"
import path from "path"
import { expect, request as pwRequest, test } from "@playwright/test"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const BASE = process.env.E2E_BACKEND_URL || "http://localhost:9000"

/**
 * The ACT rail, and the dangling-pointer board it was built for (#1856, #1857).
 *
 * ## Why these cases and not others
 *
 * Every assertion below is one that a green build, a green `tsc` and 164 green
 * unit tests all missed on this exact code, within one session:
 *
 *   - The board's node COUNT was invisible, because the canvas draws
 *     `sublabel ?? count` and the sublabel wins. A board whose whole claim is
 *     that it ranks by row count drew identical boxes.
 *   - The WhatsApp node rendered its button TWICE — the working act directly
 *     above the old `action`, whose href is null and which therefore draws a
 *     dead disabled button with the same words (#1854, again).
 *   - An act with no dry run pressed "preview" straight into the real
 *     endpoint. For this card that endpoint SENDS A WHATSAPP MESSAGE.
 *
 * 🔴 None of them throws. Each one is a button that is missing, duplicated, or
 * does something other than what it says — which is why they belong in a spec
 * that drives the screen rather than in another unit test.
 */

let seed: any
let token: string

const login = async (page: any) => {
  await page.goto("/app/login")
  // `networkidle` never settles against `medusa develop`, so wait on the form.
  await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
  await page.locator('input[name="email"]').fill(seed.email)
  await page.locator('input[name="password"]').fill(seed.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
}

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
  await api.dispose()
})

test.describe("the partner spine's control cards can be acted on", () => {
  test.beforeAll(() => {
    /*
     * 🔴 Loud, not skipped. The fixture is what makes both cards drawable at
     * all — of 338 partners on a real database, one had a WhatsApp number and
     * it was verified, and none had a custom domain. A spec that quietly
     * skipped here would be a check that never ran reading as a pass.
     */
    expect(
      seed.actRailPartnerId,
      "seed.actRailPartnerId is missing — re-run `pnpm e2e:seed`"
    ).toBeTruthy()
  })

  /*
   * 🔴 The #1854 regression, in one number. The act did not replace the old
   * `action`; both rendered, word for word identical, one of them dead.
   */
  test("offers exactly ONE verify button, not the act plus a dead one", async ({
    page,
  }) => {
    await login(page)
    await page.goto(
      `/app/partners/${seed.actRailPartnerId}/graph?node=whatsapp`
    )

    const drawer = page.getByRole("dialog")
    const verify = drawer.getByRole("button", { name: "Verify the number" })
    await expect(verify).toHaveCount(1, { timeout: 30000 })
  })

  /*
   * 🔴 The one that matters most. This endpoint sends a live WhatsApp template
   * — there is no dry run of a message that has already left — so the press
   * must be intercepted, the confirm must say so in the SERVER's words, and
   * Cancel must send nothing at all.
   */
  test("confirms before sending, and Cancel sends nothing", async ({ page }) => {
    const posted: string[] = []
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("whatsapp-verify")) {
        posted.push(r.url())
      }
    })

    await login(page)
    await page.goto(
      `/app/partners/${seed.actRailPartnerId}/graph?node=whatsapp`
    )

    const drawer = page.getByRole("dialog")
    await drawer
      .getByRole("button", { name: "Verify the number" })
      .click({ timeout: 30000 })

    const prompt = page.locator('[role="alertdialog"]')
    await expect(prompt).toBeVisible({ timeout: 10000 })
    // The server's sentence, naming the number and the irreversibility.
    await expect(prompt).toContainText(seed.actRailWhatsappNumber)
    await expect(prompt).toContainText("cannot be recalled")
    /*
     * And the confirm's last word is the ACT, not "Apply" — which is a stage
     * of a preview-then-apply flow this card does not have.
     */
    await expect(
      prompt.getByRole("button", { name: "Verify the number" })
    ).toBeVisible()

    await prompt.getByRole("button", { name: /cancel/i }).click()
    await page.waitForTimeout(1500)

    expect(
      posted,
      "Cancelling the confirm must not send the WhatsApp template"
    ).toEqual([])
  })

  test("the domain card is acted on the same way", async ({ page }) => {
    await login(page)
    await page.goto(`/app/partners/${seed.actRailPartnerId}/graph?node=domain`)

    const drawer = page.getByRole("dialog")
    const verify = drawer.getByRole("button", { name: "Verify the domain" })
    await expect(verify).toHaveCount(1, { timeout: 30000 })
    await expect(drawer).toContainText(seed.actRailCustomDomain)
  })
})

test.describe("the dangling-pointer board", () => {
  test.beforeAll(async () => {
    /*
     * The board reads the LAST RECORDED RUN of the sweep rather than sweeping
     * on open, so the fixture is a run. Dry — the job writes nothing in either
     * mode, and its audit row is the whole point.
     */
    const api = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    })
    const res = await api.post(
      "/admin/ops/maintenance-jobs/audit-dangling-links/run",
      { data: { dry_run: true, params: { min_orphans: 1 } }, timeout: 180000 }
    )
    expect(res.status(), await res.text()).toBe(200)
    const body = await res.json()
    // 🔴 Everything is under `.result`; `.summary` at the top level is null.
    expect(body.result.dry_run).toBe(true)
    expect(body.result.applied).toBe(false)
    await api.dispose()
  })

  /*
   * 🔴 The count has to be ON the node. The canvas draws `sublabel ?? count`,
   * so a sublabel of just the target hid the number on every box — and the
   * board's entire claim is that it ranks by how many rows are unexplained.
   */
  test("draws each pair with the number of rows behind it", async ({ page }) => {
    await login(page)
    await page.goto("/app/queues/dangling-pointers")

    const board = page.locator("body")
    await expect(board).toContainText("Dangling pointers", { timeout: 60000 })
    // "<n> of <m> → <target>" is the shape; assert the shape, not a fixed pair,
    // because which columns dangle is a property of the database, not the code.
    await expect(board).toContainText(/\d+ of \d+ →/, { timeout: 30000 })
    // And the board states WHEN it was measured — a count with no time
    // attached is what let a local reading be written up as a fact about prod.
    await expect(board).toContainText(/swept \d{4}-\d{2}-\d{2}/)
  })

  /*
   * 🔴 A read-only job has nothing to apply, and a DISABLED Apply would imply
   * a write that is merely unavailable rather than one that does not exist.
   */
  test("offers the sweep with no Apply, because it writes nothing", async ({
    page,
  }) => {
    await login(page)
    await page.goto("/app/queues/dangling-pointers?node=dangling")

    const drawer = page.getByRole("dialog")
    await expect(
      drawer.getByRole("button", { name: /Re-run the sweep/ })
    ).toBeVisible({ timeout: 30000 })
    await expect(drawer.getByRole("button", { name: "Apply" })).toHaveCount(0)
  })
})
