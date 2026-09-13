/**
 * #2018 end-to-end — the action leads, the detail is revealed as earned.
 *
 * Run headed so a human can watch:
 *   node apps/partner-ui/e2e/run.mjs
 *
 * What this proves that a unit test cannot: `deriveRunPhase` is pure and
 * already tested, but whether the partner SEES the action before the spec is a
 * question about a rendered page. #2018 is a layout change; only rendering
 * shows it.
 */
import { chromium, expect } from "@playwright/test"

const UI = process.env.E2E_UI_URL || "http://localhost:5173"
const { email, password, designName } = JSON.parse(process.env.E2E_FIXTURE)
const HEADED = process.env.E2E_HEADED !== "0"

const log = (ok, msg) => console.log(`${ok ? "  ✓" : "  ✗"} ${msg}`)
let failures = 0
const check = async (name, fn) => {
  try { await fn(); log(true, name) } catch (e) {
    failures++; log(false, `${name}\n      ${String(e.message).split("\n")[0]}`)
  }
}

const browser = await chromium.launch({
  headless: !HEADED,
  slowMo: HEADED ? 350 : 0,   // watchable, not sluggish
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

try {
  console.log("\n▶ sign in as the seeded partner")
  await page.goto(`${UI}/login`, { waitUntil: "domcontentloaded" })
  // The form labels are rendered EMPTY (`<Form.Label>{}</Form.Label>`), so the
  // placeholder is the only accessible handle on these inputs.
  await page.getByPlaceholder("Email").fill(email)
  await page.getByPlaceholder("Password").fill(password)
  await page.getByRole("button", { name: /continue with email/i }).click()
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 })

  console.log("▶ open the design work-order")
  await page.goto(`${UI}/orders/design`, { waitUntil: "domcontentloaded" })
  const row = page.getByText(designName, { exact: false }).first()
  await row.waitFor({ timeout: 30000 })
  await row.click()
  await page.waitForURL(/\/orders\/order_/, { timeout: 30000 })
  await page.waitForLoadState("networkidle")

  console.log("\n▶ #2018 — the action leads the page")

  const action = page.getByRole("heading", { name: /accept this run/i }).first()
  await check("the next action is 'Accept this run'", async () => {
    await expect(action).toBeVisible({ timeout: 20000 })
  })

  await check("its hint explains what accepting means", async () => {
    await expect(
      page.getByText(/confirm you'll handle this work/i).first()
    ).toBeVisible()
  })

  // The heart of it: the action must be ABOVE the job's detail on the page.
  await check("the action sits ABOVE the job detail", async () => {
    const actionBox = await action.boundingBox()
    const details = page.getByRole("button", { name: /^details$/i }).first()
    const detailsBox = await details.boundingBox()
    if (!actionBox || !detailsBox) throw new Error("could not measure both blocks")
    if (actionBox.y >= detailsBox.y) {
      throw new Error(`action at y=${actionBox.y} is not above detail at y=${detailsBox.y}`)
    }
  })

  console.log("\n▶ #2018 — detail is revealed as earned, not deleted")

  /**
   * 🔴 Anchored on the "Summary" heading, which ALWAYS renders for a design
   * work-order. The first version of this check looked for "bill of materials"
   * / "size set" — text a bare seeded design never produces — so it passed
   * whether or not the sections were revealed. A mutation (revealed={true})
   * exposed it: the gate was broken and this check stayed green.
   */
  await check("the job detail is NOT shown while the run is merely offered", async () => {
    await expect(page.getByRole("heading", { name: /^summary$/i }))
      .toHaveCount(0, { timeout: 10000 })
  })

  await check("Details reveals them — hidden, not deleted", async () => {
    await page.getByRole("button", { name: /^details$/i }).first().click()
    await expect(page.getByRole("heading", { name: /^summary$/i }).first())
      .toBeVisible({ timeout: 10000 })
  })

  console.log("\n▶ 📱 mobile — the action survives 400px")
  await page.setViewportSize({ width: 400, height: 850 })
  await page.reload({ waitUntil: "domcontentloaded" })
  await check("the action is still on the first screen at 400px", async () => {
    const a = page.getByRole("heading", { name: /accept this run/i }).first()
    await expect(a).toBeVisible({ timeout: 20000 })
    const box = await a.boundingBox()
    if (!box) throw new Error("no action block")
    if (box.y > 850) throw new Error(`action at y=${box.y} is below the fold`)
  })

  await page.screenshot({ path: "/tmp/2018-mobile.png" })
  console.log("\n  screenshot → /tmp/2018-mobile.png")

  if (HEADED) {
    console.log("\n  (holding the browser open 15s so you can look)")
    await page.waitForTimeout(15000)
  }
} finally {
  await browser.close()
}

console.log(failures === 0 ? "\n✅ all checks passed\n" : `\n❌ ${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
