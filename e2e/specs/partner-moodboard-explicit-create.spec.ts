import { test, expect, Page, request as pwRequest } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #2019 — starting a board is a DECISION, not a side effect of arriving.
 *
 * Opening an empty moodboard used to POST `/moodboard/seed` on mount. The
 * partner landed on a canvas full of frames built from a brief they had not
 * read, and the row was theirs from that moment on. A toast was added to say so,
 * which softened the surprise without removing the decision being made for them.
 *
 * What this proves that no unit test can: a board is NOT created by looking.
 * That claim is about what a mounted page does to the database, and the whole
 * defect was a `useEffect` firing on open.
 *
 * Each run mints its own invited designer, so the fixture is always a partner
 * with NO board on a design that already has ours — the exact state the bar
 * exists for — and the spec stays re-runnable despite creating a board.
 *
 * @partnerui — needs the partner-UI dev server on :5173.
 * Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-moodboard-explicit-create
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"
const PASSWORD = "supersecret123"

type Seed = { email: string; password: string; inviteDesignId: string }

let seed: Seed
let adminToken: string

test.describe("Partner moodboard: starting a board is explicit @partnerui", () => {
  test.beforeAll(async ({ baseURL }) => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.inviteDesignId) {
      throw new Error("E2E seed missing inviteDesignId — re-run the seed.")
    }

    const api = await pwRequest.newContext({ baseURL })
    const res = await api.post("/auth/user/emailpass", {
      data: { email: seed.email, password: seed.password },
    })
    expect(res.ok()).toBeTruthy()
    adminToken = (await res.json()).token
    await api.dispose()
  })

  /**
   * A brand-new invited designer on the shared brief design: they can author it,
   * and they own no board on it. Returns their portal credentials plus an
   * authenticated API context for reading the boards back.
   */
  async function freshDesigner(baseURL: string) {
    const admin = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${adminToken}` },
    })
    const mint = await admin.post(
      `/admin/designs/${seed.inviteDesignId}/designer-invites`,
      { data: { inviter_name: "Studio JYT" } }
    )
    expect(mint.status()).toBe(201)
    const { token } = await mint.json()

    const pub = await pwRequest.newContext({ baseURL })
    const email = `e2e-explicit-${Date.now()}@jyt.test`
    const acceptRes = await pub.post(`/partners/designer-invites/${token}/accept`, {
      data: { name: "Rae Weaver", email, password: PASSWORD },
    })
    expect(acceptRes.status()).toBe(201)
    const accept = await acceptRes.json()

    const api = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${accept.token}` },
    })
    await admin.dispose()
    await pub.dispose()
    return { email, api }
  }

  const boards = async (api: any) =>
    (await (await api.get(`/partners/designs/${seed.inviteDesignId}/moodboards`)).json())

  const login = async (page: Page, email: string) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
  }

  const openMoodboard = async (page: Page, email: string) => {
    await login(page, email)
    await page.goto(
      `${PARTNER_UI}/designs/${seed.inviteDesignId}/moodboard`,
      { waitUntil: "domcontentloaded" }
    )
    await page.waitForLoadState("networkidle")
  }

  test("🔴 opening the moodboard creates NO board, and offers the choice", async ({
    page,
    baseURL,
  }) => {
    const { email, api } = await freshDesigner(baseURL!)

    // The precondition, asserted rather than assumed: they start with none.
    expect((await boards(api)).own).toBeNull()

    await openMoodboard(page, email)

    const startFromBrief = page.getByRole("button", { name: /start from the brief/i })
    const startBlank = page.getByRole("button", { name: /start blank/i })
    await expect(startFromBrief).toBeVisible({ timeout: 30_000 })
    await expect(startBlank).toBeVisible()

    /**
     * 🔴 THE CLAIM. Read the database back through a fresh request, not the
     * page: the old behaviour was a mount effect, so "the canvas looks empty"
     * would have been true either way while a row was quietly written.
     */
    expect((await boards(api)).own).toBeNull()

    // And ours is what they are looking at — readable, not editable.
    await expect(page.getByRole("button", { name: /^save$/i })).toBeDisabled()

    await api.dispose()
  })

  test("'Start blank' mints their board and hands them the canvas", async ({
    page,
    baseURL,
  }) => {
    const { email, api } = await freshDesigner(baseURL!)
    await openMoodboard(page, email)

    await page.getByRole("button", { name: /start blank/i }).click()

    // The bar is gone — they have a board now, so the invitation to start one
    // must stop being offered.
    await expect(
      page.getByRole("button", { name: /start blank/i })
    ).toHaveCount(0, { timeout: 15_000 })

    // The row exists, is theirs, and is empty — blank means blank.
    const after = await boards(api)
    expect(after.own).toBeTruthy()
    expect(after.own.owner_type).toBe("partner")
    expect(after.own.is_own).toBe(true)
    expect(after.own.scene?.elements ?? []).toEqual([])

    await api.dispose()
  })

  test("'Start from the brief' builds one, and the frames are on the canvas", async ({
    page,
    baseURL,
  }) => {
    const { email, api } = await freshDesigner(baseURL!)
    await openMoodboard(page, email)

    await page.getByRole("button", { name: /start from the brief/i }).click()

    await expect(
      page.getByRole("button", { name: /start from the brief/i })
    ).toHaveCount(0, { timeout: 15_000 })

    /**
     * ⚠️ POLLED, not read once. "From the brief" is two writes — create the
     * board, then generate onto it — and the bar disappears after the FIRST,
     * because that is the moment they own a board. Reading immediately caught
     * the row mid-flight, empty, and reported that the brief had not been
     * built. The bar is evidence about ownership, not about the frames.
     */
    await expect
      .poll(
        async () => {
          const b = await boards(api)
          return ((b.own?.scene?.elements ?? []) as any[])
            .filter((e) => e.type === "frame")
            .map((f) => f.name)
        },
        { timeout: 20_000 }
      )
      .toEqual(expect.arrayContaining(["Brief · Concept & Identity"]))

    const after = await boards(api)
    expect(after.own.is_own).toBe(true)

    await api.dispose()
  })
})
