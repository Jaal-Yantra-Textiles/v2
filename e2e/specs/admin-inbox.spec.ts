import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

// E2E_SEED_FILE lets a local run point at a smaller seed (blog-email-editor
// does the same); CI uses the full seed.
const SEED_FILE = path.resolve(
  __dirname,
  "../../apps/backend",
  process.env.E2E_SEED_FILE || ".e2e-seed.json"
)
const SHOTS = path.resolve(__dirname, "../screenshots")

/**
 * #2377 — the admin Inbox: company email by folder, read in place, handed to
 * the assistant to become an inventory order.
 *
 * What a person does, end to end:
 *  - the folder rail shows this run's folders with their to-do counts;
 *  - opening the orders folder lists only its email, and opening that email
 *    renders the shop's own HTML (the item row) in the reading pane;
 *  - "Create inventory order with assistant" lands on the assistant with a
 *    prompt naming THIS email in the box — placed, not sent (CI has no model);
 *  - "Ignore" moves the other email out of To do and into Ignored;
 *  - "Choose folders" says plainly that no mail account is connected, which
 *    is the e2e database's truth (no iCloud here).
 *
 * The seed puts the two emails in folders unique to its run, so every claim
 * is about this run's rows on a database that keeps earlier runs' mail.
 */
test.describe("Admin Inbox (#2377)", () => {
  let seed: {
    email: string
    password: string
    inboxOrdersFolder: string
    inboxNotesFolder: string
    inboxOrderEmailId: string
    inboxOrderSubject: string
    inboxNoteEmailId: string
    inboxNoteSubject: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(`E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`)
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.inboxOrderEmailId) {
      throw new Error("Seed file has no inbox fixture — re-run pnpm e2e:seed on this branch.")
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

  test("read a shop's order email and hand it to the assistant", async ({ page }) => {
    await login(page)
    await page.goto("/app/inbox")
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible()

    // The rail lists this run's orders folder with one email to do.
    const rail = page.getByRole("navigation", { name: "Folders" })
    const ordersFolder = rail.getByRole("button", { name: new RegExp(seed.inboxOrdersFolder) })
    await expect(ordersFolder).toBeVisible()
    await expect(ordersFolder).toContainText("1")
    await ordersFolder.click()

    // Only that folder's email is listed; the note from the other folder is not.
    await expect(page.getByText(seed.inboxOrderSubject)).toBeVisible()
    await expect(page.getByText(seed.inboxNoteSubject)).toHaveCount(0)

    await page.getByText(seed.inboxOrderSubject).click()
    await expect(page.getByRole("heading", { name: seed.inboxOrderSubject })).toBeVisible()

    // The shop's own HTML, rendered in the sandboxed reading pane.
    const body = page.frameLocator(`iframe[title="${seed.inboxOrderSubject}"]`)
    await expect(body.getByText("Coconut shell button 15mm (pack of 100)")).toBeVisible()
    await expect(body.getByText("₹450.00")).toBeVisible()
    fs.mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, "admin-inbox-reading-pane.png") })

    await page.getByRole("button", { name: /Create inventory order with assistant/ }).click()
    await page.waitForURL(/\/app\/assistant/)
    // The prompt is placed for the operator to read and send — and the URL no
    // longer carries it, so a reload doesn't bring it back.
    const box = page.locator("textarea").first()
    await expect(box).toHaveValue(new RegExp(seed.inboxOrderEmailId))
    await expect(box).toHaveValue(/get_inbound_email/)
    await expect(page).not.toHaveURL(/prompt=/)
  })

  test("ignore an email: it leaves To do and shows under Ignored", async ({ page }) => {
    await login(page)
    await page.goto(`/app/inbox?folder=${encodeURIComponent(seed.inboxNotesFolder)}`)

    const list = page.getByRole("region", { name: "Emails" })
    const note = list.getByText(seed.inboxNoteSubject)
    const empty = list.getByText("Nothing here.")
    // Wait for the list to load either way. A Playwright retry finds the note
    // already ignored; the claim below (under Ignored, not To do) holds both ways.
    await expect(note.or(empty)).toBeVisible()
    if (await note.isVisible()) {
      await note.click()
      await page.getByRole("button", { name: "Ignore", exact: true }).click()
      // It leaves To do without a reload.
      await expect(note).toHaveCount(0)
    }

    await page.goto(`/app/inbox?folder=${encodeURIComponent(seed.inboxNotesFolder)}`)
    await expect(empty).toBeVisible()

    await page.getByRole("button", { name: "Ignored", exact: true }).click()
    await expect(note).toBeVisible()
    // An ignored email offers no conversion.
    await note.click()
    await expect(page.getByRole("button", { name: /Create inventory order/ })).toHaveCount(0)
  })

  test("Choose folders says when no mail account is connected", async ({ page }) => {
    await login(page)
    await page.goto("/app/inbox")
    await page.getByRole("button", { name: /Choose folders/ }).click()
    await expect(page.getByText("Folders to read")).toBeVisible()
    await expect(page.getByText(/No IMAP email account is connected/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled()
    await page.screenshot({ path: path.join(SHOTS, "admin-inbox-folders-drawer.png") })
  })
})
