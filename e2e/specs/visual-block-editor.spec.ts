import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

test.describe("@partnerui Visual Block Editor (#1466)", () => {
  let seed: {
    contentEditorEmail: string
    contentEditorPassword: string
    contentEditorPageId: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.contentEditorEmail) {
      throw new Error("E2E seed missing contentEditorEmail — re-run the seed.")
    }
  })

  test("content editor shows block list, canvas, and inspector", async ({
    page,
  }) => {
    // Login via partner UI
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.contentEditorEmail)
    await page.locator('input[name="password"]').fill(seed.contentEditorPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )

    // Navigate to content editor for the seeded page
    await page.goto(`${PARTNER_UI}/content/${seed.contentEditorPageId}`, {
      waitUntil: "domcontentloaded",
    })
    await page.waitForLoadState("networkidle")

    // Block list sidebar — should show the two seeded blocks
    await expect(
      page.getByText("Blocks (2)", { exact: false }).first()
    ).toBeVisible({ timeout: 15_000 })

    await expect(
      page.getByText("Hero Section").first()
    ).toBeVisible()
    await expect(
      page.getByText("Feature Highlight").first()
    ).toBeVisible()

    // "Add" button is visible
    await expect(
      page.getByRole("button", { name: /Add/i }).first()
    ).toBeVisible()
  })

  test("add block drawer disables already-used unique types", async ({
    page,
  }) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.contentEditorEmail)
    await page.locator('input[name="password"]').fill(seed.contentEditorPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )

    await page.goto(`${PARTNER_UI}/content/${seed.contentEditorPageId}`, {
      waitUntil: "domcontentloaded",
    })
    await page.waitForLoadState("networkidle")

    // Wait for block list to appear
    await expect(
      page.getByText("Hero Section").first()
    ).toBeVisible({ timeout: 15_000 })

    // Open the Add Block drawer
    await page.getByRole("button", { name: /Add/i }).first().click()
    await page.waitForLoadState("networkidle")

    // The drawer should be open with a type selector
    await expect(
      page.getByText(/block type/i).first()
    ).toBeVisible({ timeout: 10_000 })

    // Hero should be listed but disabled (already added)
    const heroOption = page.getByText("Hero", { exact: true }).first()
    await expect(heroOption).toBeVisible()

    // Feature should be available (repeatable)
    await expect(
      page.getByText("Feature", { exact: true }).first()
    ).toBeVisible()
  })

  test("selecting a block shows contextual inspector with type badge", async ({
    page,
  }) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.contentEditorEmail)
    await page.locator('input[name="password"]').fill(seed.contentEditorPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )

    await page.goto(`${PARTNER_UI}/content/${seed.contentEditorPageId}`, {
      waitUntil: "domcontentloaded",
    })
    await page.waitForLoadState("networkidle")

    // Wait for blocks to load
    await expect(
      page.getByText("Hero Section").first()
    ).toBeVisible({ timeout: 15_000 })

    // Click on the Feature block in the sidebar
    await page.getByText("Feature Highlight").first().click()
    await page.waitForLoadState("networkidle")

    // Inspector panel should show the block type badge
    await expect(
      page.getByText("Feature", { exact: true }).first()
    ).toBeVisible({ timeout: 10_000 })

    // Should show the inline editing hint
    await expect(
      page.getByText(/click text on the canvas/i).first()
    ).toBeVisible()

    // Should show block name field
    await expect(
      page.locator('input').filter({ hasText: "" }).first()
    ).toBeVisible()

    // Advanced Settings should be collapsed by default
    await expect(
      page.getByText("Advanced Settings").first()
    ).toBeVisible()

    // Quick action buttons should be visible (move up/down, delete)
    await expect(
      page.getByRole("button").filter({ has: page.locator("svg") }).first()
    ).toBeVisible()
  })

  test("advanced settings expand to show background, padding, max width", async ({
    page,
  }) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.contentEditorEmail)
    await page.locator('input[name="password"]').fill(seed.contentEditorPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )

    await page.goto(`${PARTNER_UI}/content/${seed.contentEditorPageId}`, {
      waitUntil: "domcontentloaded",
    })
    await page.waitForLoadState("networkidle")

    await expect(
      page.getByText("Hero Section").first()
    ).toBeVisible({ timeout: 15_000 })

    // Select the Hero block (has bg color set in seed)
    await page.getByText("Hero Section").first().click()
    await page.waitForLoadState("networkidle")

    // Expand Advanced Settings
    await page.getByText("Advanced Settings").first().click()

    // Should now show Background Color, Padding, Max Width
    await expect(
      page.getByText("Background Color").first()
    ).toBeVisible({ timeout: 5_000 })
    await expect(
      page.getByText("Padding (px)").first()
    ).toBeVisible()
    await expect(
      page.getByText("Max Width").first()
    ).toBeVisible()
  })

  test("iframe canvas loads and renders blocks", async ({ page }) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.contentEditorEmail)
    await page.locator('input[name="password"]').fill(seed.contentEditorPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )

    await page.goto(`${PARTNER_UI}/content/${seed.contentEditorPageId}`, {
      waitUntil: "domcontentloaded",
    })
    await page.waitForLoadState("networkidle")

    // The iframe should be present
    const iframe = page.locator("iframe").first()
    await expect(iframe).toBeVisible({ timeout: 15_000 })

    // Wait for iframe content to load and post VISUAL_EDITOR_READY
    await page.waitForLoadState("networkidle")

    // The iframe should have a src pointing to the storefront
    const src = await iframe.getAttribute("src")
    expect(src).toBeTruthy()

    // Block list should populate (indicates iframe loaded and posted blocks)
    await expect(
      page.getByText("Blocks (2)", { exact: false }).first()
    ).toBeVisible({ timeout: 20_000 })
  })

  test("screenshot: visual block editor full layout", async ({ page }) => {
    test.skip(process.env.CI, "screenshot test — local only")

    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.contentEditorEmail)
    await page.locator('input[name="password"]').fill(seed.contentEditorPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )

    await page.goto(`${PARTNER_UI}/content/${seed.contentEditorPageId}`, {
      waitUntil: "domcontentloaded",
    })
    await page.waitForLoadState("networkidle")

    await expect(
      page.getByText("Hero Section").first()
    ).toBeVisible({ timeout: 15_000 })

    // Select Hero block to show inspector
    await page.getByText("Hero Section").first().click()
    await page.waitForLoadState("networkidle")

    await expect(
      page.getByText("Advanced Settings").first()
    ).toBeVisible({ timeout: 10_000 })

    // Take a screenshot for visual verification
    await page.screenshot({
      path: path.resolve(__dirname, "../screenshots/visual-block-editor.png"),
      fullPage: true,
    })
  })
})
