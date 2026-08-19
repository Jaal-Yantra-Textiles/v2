import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * The CRM contact record: how you get OUT of it, and where the conversation
 * lives.
 *
 * Two things were wrong with the first cut, and both are the kind that a
 * typecheck and a green build sail straight past because they are about layout
 * and navigation rather than types:
 *
 *  1. The page's only way back was a "Back" button, and the breadcrumb — the
 *     admin's actual navigation — read the raw record id. A trail that says
 *     `per_01J…` is a receipt, not navigation.
 *  2. The activity LOGGER sat above the activity HISTORY, so the first thing
 *     the page said was "type something" rather than "here is where this
 *     conversation got to". Logging now happens in a drawer, and the timeline
 *     is a section of the record.
 *
 * Requires `CRM_HYPERBEE=true` — the CRM is a Hyperbee node, not Postgres, and
 * with no store registered these screens render an empty state that would let
 * a broken section pass. The seed's `crmPersonId` is the guard: it cannot be
 * written at all unless the module resolved.
 */
test.describe("CRM contact detail", () => {
  let seed: {
    email: string
    password: string
    crmPersonId: string
    crmPersonName: string
    crmActivityBody: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.crmPersonId) {
      throw new Error(
        "E2E seed missing crmPersonId — re-run the seed with CRM_HYPERBEE=true."
      )
    }
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    // `networkidle` never settles against `medusa develop` (the dev server
    // holds long-lived connections open), so wait on the form itself.
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  test("names the contact in the breadcrumb instead of offering a Back button", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/crm/${seed.crmPersonId}`)

    // The record loaded.
    await expect(
      page.getByRole("heading", { name: seed.crmPersonName })
    ).toBeVisible({ timeout: 20000 })

    // The breadcrumb says the person's NAME. It is fed by the route loader, so
    // this also proves the loader ran — without it `match.data` is undefined
    // and the crumb silently falls back to the id.
    //
    // Targeted as a listitem rather than by scoping to a `nav`: the admin's
    // FIRST nav is the sidebar, and the breadcrumb is a plain list in the
    // topbar. The page heading carries the same text, so a bare text match
    // would pass on the heading alone and prove nothing about the crumb —
    // `listitem` is what separates them.
    const crumb = page.getByRole("listitem").filter({ hasText: seed.crmPersonName })
    await expect(crumb).toHaveCount(1)
    await expect(crumb).toBeVisible()

    // …and specifically NOT the id, which is what it printed before.
    await expect(
      page.getByRole("listitem").filter({ hasText: seed.crmPersonId })
    ).toHaveCount(0)

    // The competing way out is gone. Scoped by role so the word "Back"
    // appearing in body copy somewhere cannot fail this.
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0)
  })

  test("shows the timeline as its own section, with logging behind a drawer", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/crm/${seed.crmPersonId}`)

    const activityHeading = page.getByRole("heading", { name: "Activity" })
    await expect(activityHeading).toBeVisible({ timeout: 20000 })

    // The seeded interaction is READ without opening anything…
    await expect(page.getByText(seed.crmActivityBody)).toBeVisible()

    // …and the section sits BELOW the contact details rather than above them,
    // which is the whole point of the split. Geometric rather than structural:
    // a class or wrapper rename should not fail this, a re-ordered page should.
    const emailRow = page.getByText("Email", { exact: true }).first()
    const [emailBox, activityBox] = await Promise.all([
      emailRow.boundingBox(),
      activityHeading.boundingBox(),
    ])
    if (!emailBox || !activityBox) {
      throw new Error("Could not measure the contact detail sections")
    }
    expect(
      activityBox.y,
      `the Activity section (y=${activityBox.y}) should sit below the contact ` +
        `details (Email row y=${emailBox.y}) — if it is above, the logger has ` +
        `been put back in front of the history`
    ).toBeGreaterThan(emailBox.y)

    // The form is NOT on the page until asked for.
    await expect(page.getByPlaceholder("Called about the sampling order", { exact: false })).toHaveCount(0)

    await page.getByRole("button", { name: "Log activity" }).first().click()

    // The drawer's own title, so this cannot be satisfied by the button that
    // opened it.
    await expect(
      page.getByRole("heading", { name: "Log activity" })
    ).toBeVisible({ timeout: 10000 })
    await expect(page.getByText("What kind of contact was it?")).toBeVisible()
  })

  test("logs an activity from the drawer and shows it on the timeline", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/crm/${seed.crmPersonId}`)

    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible({
      timeout: 20000,
    })

    await page.getByRole("button", { name: "Log activity" }).first().click()
    await expect(
      page.getByRole("heading", { name: "Log activity" })
    ).toBeVisible({ timeout: 10000 })

    const body = `E2E note ${Date.now()}`
    await page.getByRole("textbox").last().fill(body)

    // The drawer's own submit, not the section button that opened it.
    await page
      .getByRole("button", { name: "Log activity", exact: true })
      .last()
      .click()

    // It reaches the timeline — which means the write landed AND the list was
    // invalidated. A drawer that closes on success while the section still
    // shows the old list is the failure this catches.
    await expect(page.getByText(body)).toBeVisible({ timeout: 20000 })
  })
})
