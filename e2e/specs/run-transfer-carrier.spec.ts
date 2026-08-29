import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #1553 — the waybill survives the booking toast.
 *
 * 🔴 You could book a real, billable AWB from the run page and then never see
 * the number again: it was shown once, at the moment of booking, and the
 * transfer route returned `shipment_id` raw, so the carrier never left the
 * server. The operator's next question — "has it been picked up?" — had no
 * answer on the screen they were on, precisely because the goods had moved.
 *
 * The fixture run carries one hop of each carrier state, because the second
 * half of the change is that `not_booked` and `unresolved` must NOT read the
 * same. A booked-only fixture would pass against a screen that collapses them,
 * and that collapse is what sends someone to re-book goods a carrier already
 * collected.
 */
test.describe("Run transfer carrier facts (#1553)", () => {
  let seed: {
    email: string
    password: string
    transferRunId: string
    transferBookedAwb: string
    transferBookedCarrier: string
    transferDanglingShipmentId: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.transferRunId) {
      throw new Error("E2E seed missing transferRunId — re-run the seed.")
    }
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    // `networkidle` never settles against `medusa develop` (the dev server holds
    // long-lived connections open), so wait on the form itself.
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  const openRun = async (page: any) => {
    await login(page)
    await page.goto(`/app/production-runs/${seed.transferRunId}`)
    // The panel, not the page: a run page that rendered with the transfers
    // still loading would let the absence assertions below pass vacuously.
    await expect(page.getByText("No carrier booked")).toBeVisible({
      timeout: 20000,
    })
  }

  test("shows the AWB, carrier, status and pickup date on the booked hop", async ({
    page,
  }) => {
    await openRun(page)

    /**
     * One assembled sentence rather than four assertions, deliberately: the
     * helper joins only the facts that actually arrived, and a partial booking
     * printing "null · AWB null" would be worse than the toast this replaces.
     */
    const line = page.getByText(
      new RegExp(`${seed.transferBookedCarrier}.*AWB ${seed.transferBookedAwb}`)
    )
    await expect(line).toBeVisible()
    // The underscore is not shown to an operator.
    await expect(line).toContainText("pickup scheduled")
    await expect(line).toContainText("pickup")

    // And the two things the AWB is FOR — neither of which existed on screen
    // before, since the client had no url to render.
    await expect(page.getByRole("link", { name: "Track" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Label" })).toBeVisible()
  })

  test("distinguishes a hop with no carrier from one whose shipment cannot be read", async ({
    page,
  }) => {
    await openRun(page)

    // `not_booked` — a van run between two of our own locations. Final answer.
    await expect(page.getByText("No carrier booked")).toBeVisible()

    /**
     * `unresolved` — a waybill exists and we could not read it. It must name
     * the shipment it could not resolve, and must NOT say "No carrier booked":
     * that sentence would tell an operator nobody booked this hop, which is the
     * #1621 shape and, here, a second booking for goods already collected.
     */
    const unresolved = page.getByText(
      new RegExp(
        `Carrier booked — shipment ${seed.transferDanglingShipmentId} could not be read`
      )
    )
    await expect(unresolved).toBeVisible()

    // Three hops, three distinct sentences — so the states are not collapsing
    // into each other off-screen.
    await expect(page.getByText("No carrier booked")).toHaveCount(1)
    await expect(unresolved).toHaveCount(1)
  })
})
