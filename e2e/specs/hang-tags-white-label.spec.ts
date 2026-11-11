import { test, expect, Page } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"
import { PDFDocument } from "pdf-lib"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #2541 — white-label hang tags, driven through the admin:
 *  1. add a brand profile in Settings → Hang Tag (starts with story, care and
 *     MRP on, our QR off),
 *  2. open its design in the canvas editor, turn a section off, save,
 *  3. print the seeded order's tags from the order page in that brand: one
 *     tag per piece, front + back, downloaded as one PDF.
 */
test.describe("White-label hang tags (#2541)", () => {
  let seed: { email: string; password: string; hangTagOrderId: string }
  const brandName = `E2E Brand ${Date.now()}`
  let brandId: string | null = null

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(`E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`)
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.hangTagOrderId) {
      throw new Error("E2E seed missing hangTagOrderId — re-run the seed.")
    }
  })

  const login = async (page: Page) => {
    await page.goto("/app/login")
    await page.waitForLoadState("networkidle")
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15_000 })
  }

  const readBrand = async (page: Page) => {
    const res = await page.request.get("/admin/hang-tag-settings/brands")
    expect(res.ok()).toBeTruthy()
    const { brands } = await res.json()
    return brands.find((b: any) => b.config.brand_name === brandName)
  }

  test.afterAll(async ({ browser }) => {
    if (!brandId) return
    const page = await browser.newPage()
    await login(page)
    await page.request.delete(`/admin/hang-tag-settings/brands/${brandId}`)
    await page.close()
  })

  test("add a brand, edit its design, print an order's tags in it", async ({ page }) => {
    await login(page)

    // ── 1. Add the brand ──────────────────────────────────────────────────
    await page.goto("/app/settings/hang-tag")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("heading", { name: "White-label brands" })).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: "Add brand" }).click()
    const drawer = page.getByRole("dialog")
    await drawer.getByPlaceholder("Oshen").fill(brandName)
    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/admin/hang-tag-settings/brands") && r.request().method() === "POST"
      ),
      drawer.getByRole("button", { name: "Save" }).click(),
    ])
    expect(created.status()).toBe(201)
    await expect(page.getByText(brandName, { exact: true })).toBeVisible()

    const brand = await readBrand(page)
    brandId = brand.id
    expect(brand.config).toMatchObject({ show_story: true, show_care: true, show_mrp: true, show_qr_code: false })

    // ── 2. Design it in the canvas editor: turn care off, save ────────────
    const row = page.locator("div", { has: page.getByText(brandName, { exact: true }) }).filter({
      has: page.getByRole("button", { name: "Design" }),
    })
    await row.last().getByRole("button", { name: "Design" }).click()
    await expect(page.getByRole("heading", { name: `${brandName} tag design` })).toBeVisible()

    const careToggle = page
      .getByText("Care instructions", { exact: true })
      .locator("xpath=../..")
      .getByRole("switch")
    await expect(careToggle).toBeChecked()
    await careToggle.click()
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/admin/hang-tag-settings/brands/${brandId}`) && r.request().method() === "PUT"
      ),
      page.getByRole("button", { name: "Save", exact: true }).click(),
    ])
    expect(saved.ok()).toBeTruthy()

    const afterDesign = await readBrand(page)
    expect(afterDesign.config.show_care).toBe(false)
    expect(afterDesign.config.show_story).toBe(true)
    // The default config is untouched by a brand's design.
    const def = await (await page.request.get("/admin/hang-tag-settings")).json()
    expect(def.config.brand_name).not.toBe(brandName)

    // ── 3. Print the order's tags in that brand ───────────────────────────
    await page.goto(`/app/orders/${seed.hangTagOrderId}`)
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("heading", { name: "Hang tags" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/^2 tags, one per piece/)).toBeVisible()

    await page.getByRole("button", { name: "Make tags" }).click()
    const review = page.getByRole("dialog")
    await expect(review.getByText(/Hang tags for order #/)).toBeVisible()

    await review.getByRole("combobox").click()
    await page.getByRole("option", { name: brandName }).click()

    // Story on, care off for this brand; the seeded product has no design.
    await expect(review.getByText("The story", { exact: true })).toBeVisible()
    await expect(review.getByText("Care", { exact: true })).toHaveCount(0)
    await expect(review.getByText("No story in records")).toBeVisible()
    await review.getByRole("textbox").nth(1).fill("Woven by hand for the e2e test.")

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      review.getByRole("button", { name: "Generate 2 tags" }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^hang-tags-e2e-brand-\d+-\d+\.pdf$/)
    const file = await download.path()
    const bytes = fs.readFileSync(file!)
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
    // 2 pieces × (front + back)
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(4)
  })
})
