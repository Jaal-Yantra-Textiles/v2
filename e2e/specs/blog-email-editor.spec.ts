import { test, expect, type Page } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #2349 — the blog modal's Email tab (React Email editor).
 *
 * What only a browser can prove:
 *  1. The editor actually mounts inside the admin bundle (a new dependency,
 *     its CSS, and a backend util imported into the admin).
 *  2. A starter template opens as real email blocks (title, columns, button)
 *     and is SAVED as `content.email_doc` + `content.email_html` on the block.
 *  3. The Website and Email tabs share one `block.content` (the server
 *     deep-merges each save), so a Website autosave after an Email save keeps
 *     the email, and vice versa — and per-keystroke autosaves land in order,
 *     newest text last. Read back from the API, not the UI.
 *
 * Sends nothing and uploads nothing: it creates a Draft blog page on the seeded
 * website and deletes it afterwards.
 */

// E2E_SEED_FILE lets a local run use the admin-only seed
// (e2e/helpers/e2e-seed-admin-only.ts) when the full seed can't finish.
const SEED_FILE = process.env.E2E_SEED_FILE
  ? path.resolve(process.env.E2E_SEED_FILE)
  : path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const SHOTS = path.resolve(__dirname, "../screenshots")

type Seed = { email: string; password: string; websiteId: string }
let seed: Seed

const BLOG_HEADING = "Woven in Dharamshala"
const BLOG_DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: BLOG_HEADING }] },
    { type: "paragraph", content: [{ type: "text", text: "A short story about the loom." }] },
  ],
}

const login = async (page: Page) => {
  await page.goto("/app/login")
  await page.locator('input[name="email"]').fill(seed.email)
  await page.locator('input[name="password"]').fill(seed.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app\/(?!login)/, { timeout: 15_000 })
}

const readBlock = async (page: Page, pageId: string, blockId: string) => {
  const res = await page.request.get(
    `/admin/websites/${seed.websiteId}/pages/${pageId}/blocks/${blockId}`
  )
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  return body.block ?? body
}

test.describe("Blog Email tab (#2349)", () => {
  let pageId = ""
  let blockId = ""

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(`E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`)
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    fs.mkdirSync(SHOTS, { recursive: true })
  })

  test.afterEach(async ({ page }) => {
    if (pageId) {
      await page.request.delete(`/admin/websites/${seed.websiteId}/pages/${pageId}`).catch(() => undefined)
    }
  })

  test("a template is saved as email HTML and survives a website autosave", async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)

    const stamp = Date.now()
    const created = await page.request.post(`/admin/websites/${seed.websiteId}/pages`, {
      data: {
        title: `E2E email tab ${stamp}`,
        slug: `e2e-email-tab-${stamp}`,
        content: "e2e",
        page_type: "Blog",
        status: "Draft",
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    pageId = (await created.json()).page.id

    const blockRes = await page.request.post(
      `/admin/websites/${seed.websiteId}/pages/${pageId}/blocks`,
      {
        data: {
          blocks: [
            {
              name: "Main Blog",
              type: "MainContent",
              content: {
                type: "blog",
                authors: [],
                layout: "full",
                image: { type: "image", content: "" },
                text: BLOG_DOC,
              },
            },
          ],
        },
      }
    )
    expect(blockRes.status(), await blockRes.text()).toBe(201)
    blockId = (await blockRes.json()).blocks[0].id

    await page.goto(`/app/websites/${seed.websiteId}/pages/${pageId}/blocks/${blockId}`)
    await expect(page.getByText("Edit Blog Content")).toBeVisible({ timeout: 30_000 })

    // ── 1. The Email tab mounts the React Email editor ──────────────────────
    await page.getByRole("tab", { name: "Email" }).click()
    const templates = page.getByRole("button", { name: "Templates" })
    await expect(templates).toBeVisible()
    await expect(page.getByRole("button", { name: "Image" })).toBeVisible()

    // ── 2. A starter template opens as email blocks and is saved ────────────
    await templates.click()
    await page.getByRole("menuitem", { name: /Newsletter/ }).click()
    const editor = page.locator(".tiptap").filter({ hasText: "A short opening line" })
    await expect(editor).toBeVisible()
    await expect(editor.getByText("Read on jaalyantra.com")).toBeVisible()
    await expect(editor.locator('[data-type="two-columns"], .node-columns').first()).toBeVisible()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: path.join(SHOTS, "blog-email-tab-newsletter.png"), fullPage: true })

    let block = await readBlock(page, pageId, blockId)
    expect(block.content.email_doc?.type).toBe("doc")
    expect(block.content.email_html).toContain("A short opening line")
    expect(block.content.email_html).toContain("https://jaalyantra.com")
    expect(block.content.email_html).toMatch(/<body[\s>]/i)
    // Kept as an artifact so the whole email can be rendered in its frame.
    fs.writeFileSync(path.join(SHOTS, "blog-email-tab-newsletter.html"), block.content.email_html)
    // The website text is untouched by the email save.
    expect(JSON.stringify(block.content.text)).toContain(BLOG_HEADING)

    // ── 3. A Website autosave must not wipe the email version ───────────────
    await page.getByRole("tab", { name: "Website" }).click()
    const webEditor = page.locator(".tiptap").filter({ hasText: BLOG_HEADING })
    await webEditor.getByText("A short story about the loom.").click()
    await page.keyboard.press("End")
    await page.keyboard.type(" Edited on the web.")
    await expect
      .poll(async () => JSON.stringify((await readBlock(page, pageId, blockId)).content.text), {
        timeout: 20_000,
      })
      .toContain("Edited on the web.")

    block = await readBlock(page, pageId, blockId)
    expect(block.content.email_html).toContain("A short opening line")
    expect(block.content.email_doc?.type).toBe("doc")

    // ── 4. "Start from this blog post" replaces the email after confirming ──
    await page.getByRole("tab", { name: "Email" }).click()
    await templates.click()
    await page.getByRole("menuitem", { name: "Start from this blog post" }).click()
    await page.getByRole("button", { name: "Replace" }).click()
    await expect(page.locator(".tiptap").filter({ hasText: BLOG_HEADING }).first()).toBeVisible()
    await expect
      .poll(async () => (await readBlock(page, pageId, blockId)).content.email_html ?? "", {
        timeout: 20_000,
      })
      .toContain(BLOG_HEADING)

    // The Email save after the Website edit kept the website text.
    block = await readBlock(page, pageId, blockId)
    expect(JSON.stringify(block.content.text)).toContain("Edited on the web.")

    // ── 5. Preview renders the email HTML ───────────────────────────────────
    await page.getByRole("button", { name: "Preview" }).click()
    const preview = page.frameLocator('iframe[title="Email preview"]')
    await expect(preview.getByText(BLOG_HEADING)).toBeVisible()
    await page.waitForTimeout(500) // let the drawer finish sliding in
    await page.screenshot({ path: path.join(SHOTS, "blog-email-tab-preview.png"), fullPage: true })
  })
})

test.describe("Blog Email tab — product cards (#2349 S4)", () => {
  let pageId = ""
  let productId = ""

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(`E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`)
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    fs.mkdirSync(SHOTS, { recursive: true })
  })

  test.afterEach(async ({ page }) => {
    if (pageId) {
      await page.request.delete(`/admin/websites/${seed.websiteId}/pages/${pageId}`).catch(() => undefined)
    }
    if (productId) {
      await page.request.delete(`/admin/products/${productId}`).catch(() => undefined)
    }
  })

  test("a house-store product becomes a card with a UTM-tagged shop link", async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)
    const stamp = Date.now()

    // A published product in the house store (the store with no partner).
    const storesRes = await page.request.get("/admin/stores?fields=id,default_sales_channel_id,metadata")
    expect(storesRes.ok()).toBeTruthy()
    const house = (await storesRes.json()).stores.find((s: any) => !s.metadata?.partner_id)
    expect(house?.default_sales_channel_id, "house store with a sales channel").toBeTruthy()

    const title = `E2E Card Shawl ${stamp}`
    const handle = `e2e-card-shawl-${stamp}`
    const productRes = await page.request.post("/admin/products", {
      data: {
        title,
        handle,
        status: "published",
        thumbnail: "https://placehold.co/600x600/png?text=Shawl",
        sales_channels: [{ id: house.default_sales_channel_id }],
        options: [{ title: "Size", values: ["One", "Two"] }],
        variants: [
          { title: "One", options: { Size: "One" }, manage_inventory: false, prices: [{ currency_code: "inr", amount: 2500 }] },
          { title: "Two", options: { Size: "Two" }, manage_inventory: false, prices: [{ currency_code: "inr", amount: 3200 }] },
        ],
      },
    })
    expect(productRes.status(), await productRes.text()).toBe(200)
    productId = (await productRes.json()).product.id

    // A blog page whose slug becomes the link's utm_campaign.
    const slug = `e2e-card-${stamp}`
    const created = await page.request.post(`/admin/websites/${seed.websiteId}/pages`, {
      data: { title: `E2E card ${stamp}`, slug, content: "e2e", page_type: "Blog", status: "Draft" },
    })
    expect(created.status(), await created.text()).toBe(201)
    pageId = (await created.json()).page.id
    const blockRes = await page.request.post(`/admin/websites/${seed.websiteId}/pages/${pageId}/blocks`, {
      data: {
        blocks: [
          {
            name: "Main Blog",
            type: "MainContent",
            content: { type: "blog", authors: [], layout: "full", image: { type: "image", content: "" }, text: BLOG_DOC },
          },
        ],
      },
    })
    expect(blockRes.status(), await blockRes.text()).toBe(201)
    const blockId = (await blockRes.json()).blocks[0].id
    const blockUrl = `/app/websites/${seed.websiteId}/pages/${pageId}/blocks/${blockId}`

    await page.goto(blockUrl)
    await expect(page.getByText("Edit Blog Content")).toBeVisible({ timeout: 30_000 })
    await page.getByRole("tab", { name: "Email" }).click()

    // ── Pick the product ────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Product", exact: true }).click()
    await page.getByPlaceholder("Search products").fill(title)
    const item = page.getByTestId("product-picker-item").filter({ hasText: title })
    await expect(item).toBeVisible({ timeout: 20_000 })
    await expect(item).toContainText("From ₹2,500")
    await item.click()

    const card = page.locator('.tiptap [data-type="product-card"]')
    await expect(card).toContainText(title)
    await expect(card).toContainText("Shop now")
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: path.join(SHOTS, "blog-email-product-card.png"), fullPage: true })

    // ── Read the saved email back ───────────────────────────────────────────
    const block = await readBlock(page, pageId, blockId)
    const html: string = block.content.email_html ?? ""
    expect(html).toContain(title)
    expect(html).toContain("From ₹2,500")
    expect(html).toContain('src="https://placehold.co/600x600/png?text=Shawl"')
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"))
    const shop = hrefs.filter((h) => h.startsWith(`https://cicilabel.com/products/${handle}?`))
    expect(shop.length, `shop links in ${hrefs.join(", ")}`).toBe(2) // the photo and the button
    const params = Object.fromEntries(new URL(shop[0]).searchParams)
    expect(params).toEqual({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: slug,
      utm_content: "product_card",
    })
    fs.writeFileSync(path.join(SHOTS, "blog-email-product-card.html"), html)

    // ── It reopens as a card, not lost text ─────────────────────────────────
    await page.reload()
    await expect(page.getByText("Edit Blog Content")).toBeVisible({ timeout: 30_000 })
    await page.getByRole("tab", { name: "Email" }).click()
    await expect(page.locator('.tiptap [data-type="product-card"]')).toContainText(title)
  })
})
