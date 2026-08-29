/**
 * Per-piece prices on a payout line (#1596).
 *
 *   POST /admin/payment-submissions    { rate_breakdown: { [designId]: [...] } }
 *   POST /partners/payment-submissions { rate_breakdown: … }
 *
 * ## Why an integration test
 *
 * `foldRateBreakdown` is unit-tested. What it cannot prove is that the bands
 * survive the trip: validator → route → workflow input → the `model.json()`
 * column and back out of a `GET`. Every step in that chain has dropped a field
 * silently before — a value the validator accepts but the handler never
 * forwards is gone with a 200 and no dry-run can reveal it (#1614), and the
 * create response returns `items: []`, so the amount is invisible until the
 * submission is fetched again (#1616). So every case here RE-READS.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  let adminHeaders: any
  let partnerId: string
  let designId: string

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    adminHeaders = await getAuthHeaders(api)

    const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const email = `bands-${unique}@jyt.test`
    const password = "supersecret"

    await api.post("/auth/partner/emailpass/register", { email, password })
    const login = await api.post("/auth/partner/emailpass", { email, password })
    const partnerRes = await api.post(
      "/partners",
      {
        name: `Bands ${unique}`,
        handle: `bands-${unique}`,
        admin: { email, first_name: "Bands", last_name: "Partner" },
      },
      { headers: { Authorization: `Bearer ${login.data.token}` } }
    )
    partnerId = partnerRes.data.partner.id

    const designRes = await api.post(
      "/admin/designs",
      {
        name: `Bands design ${unique}`,
        description: "Per-piece priced design",
        design_type: "Original",
        status: "Commerce_Ready",
        priority: "Medium",
        estimated_cost: 850,
        cost_currency: "inr",
      },
      adminHeaders
    )
    designId = designRes.data.design.id

    const remoteLink = getContainer().resolve(
      ContainerRegistrationKeys.LINK
    ) as any
    await remoteLink.create({
      design: { design_id: designId },
      partner: { partner_id: partnerId },
    })
  })

  /** Re-read, never trust the create response — see the header. */
  async function readLine(submissionId: string) {
    const res = await api.get(
      `/admin/payment-submissions/${submissionId}`,
      adminHeaders
    )
    expect(res.status).toBe(200)
    const items = res.data.payment_submission.items
    expect(items).toHaveLength(1)
    return items[0]
  }

  const post = (body: Record<string, any>) =>
    api
      .post("/admin/payment-submissions", { partner_id: partnerId, design_ids: [designId], ...body }, adminHeaders)
      .catch((e: any) => e.response)

  // ─── the cases ────────────────────────────────────────────────────────────

  it("stores the bands and bills their sum", async () => {
    // The issue's own example: 3 at 850 and 1 at 1,200.
    const res = await post({
      rate_breakdown: {
        [designId]: [
          { quantity: 3, unit_amount: 850 },
          { quantity: 1, unit_amount: 1200 },
        ],
      },
    })
    expect(res.status).toBe(201)
    expect(res.data.payment_submission.total_amount).toBe(3750)

    const line = await readLine(res.data.payment_submission.id)

    expect(Number(line.amount)).toBe(3750)
    expect(Number(line.quantity)).toBe(4)
    expect(line.rate_breakdown).toEqual([
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])
  })

  it("🔴 leaves unit_amount NULL on a mixed line rather than averaging", async () => {
    // 937.50 is a rate nobody agreed to, and the model says a reader wanting
    // "3 × 850" must read `unit_amount` rather than dividing.
    const res = await post({
      rate_breakdown: {
        [designId]: [
          { quantity: 3, unit_amount: 850 },
          { quantity: 1, unit_amount: 1200 },
        ],
      },
    })

    const line = await readLine(res.data.payment_submission.id)

    expect(line.unit_amount).toBeNull()
  })

  it("keeps the rate when every band agrees", async () => {
    const res = await post({
      rate_breakdown: {
        [designId]: [
          { quantity: 3, unit_amount: 850 },
          { quantity: 6, unit_amount: 850 },
        ],
      },
    })

    const line = await readLine(res.data.payment_submission.id)

    expect(Number(line.amount)).toBe(7650)
    expect(Number(line.quantity)).toBe(9)
    expect(Number(line.unit_amount)).toBe(850)
  })

  it("refuses a total that disagrees with the bands, naming both numbers", async () => {
    // Two spellings of one fact must agree, or the caller decides which —
    // picking a winner silently is how the money gets decided by whichever
    // branch ran first (#1557).
    const res = await post({
      cost_overrides: { [designId]: 3000 },
      rate_breakdown: {
        [designId]: [
          { quantity: 3, unit_amount: 850 },
          { quantity: 1, unit_amount: 1200 },
        ],
      },
    })

    expect(res.status).toBe(400)
    expect(res.data.message).toContain("3750")
    expect(res.data.message).toContain("3000")
  })

  it("accepts a total that agrees", async () => {
    const res = await post({
      cost_overrides: { [designId]: 3750 },
      rate_breakdown: {
        [designId]: [
          { quantity: 3, unit_amount: 850 },
          { quantity: 1, unit_amount: 1200 },
        ],
      },
    })

    expect(res.status).toBe(201)
    expect(res.data.payment_submission.total_amount).toBe(3750)
  })

  it("refuses a single band at the boundary", async () => {
    // One band is an ordinary priced line and belongs in quantities +
    // unit_amounts, where every existing reader already looks.
    const res = await post({
      rate_breakdown: { [designId]: [{ quantity: 9, unit_amount: 850 }] },
    })

    expect(res.status).toBe(400)
  })

  it("refuses a zero or negative rate at the boundary", async () => {
    const zero = await post({
      rate_breakdown: {
        [designId]: [
          { quantity: 3, unit_amount: 0 },
          { quantity: 1, unit_amount: 1200 },
        ],
      },
    })
    expect(zero.status).toBe(400)

    const negative = await post({
      rate_breakdown: {
        [designId]: [
          { quantity: 3, unit_amount: -850 },
          { quantity: 1, unit_amount: 1200 },
        ],
      },
    })
    expect(negative.status).toBe(400)
  })

  it("leaves an ordinary line's rate_breakdown null", async () => {
    // 20 of the 21 payment lines on prod. The common case must be untouched.
    const res = await post({ cost_overrides: { [designId]: 1000 } })
    expect(res.status).toBe(201)

    const line = await readLine(res.data.payment_submission.id)

    expect(line.rate_breakdown).toBeNull()
  })

  it("accepts bands for a design whose stored estimate is missing", async () => {
    // 103 of the 118 `total`-priced runs on prod carry no rate at all. Refusing
    // here would block the very case bands exist to express.
    const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const costless = await api.post(
      "/admin/designs",
      {
        name: `Costless ${unique}`,
        description: "No estimate",
        design_type: "Original",
        status: "Commerce_Ready",
        priority: "Medium",
        cost_currency: "inr",
      },
      adminHeaders
    )
    const costlessId = costless.data.design.id
    const remoteLink = getContainer().resolve(
      ContainerRegistrationKeys.LINK
    ) as any
    await remoteLink.create({
      design: { design_id: costlessId },
      partner: { partner_id: partnerId },
    })

    const res = await api
      .post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [costlessId],
          rate_breakdown: {
            [costlessId]: [
              { quantity: 2, unit_amount: 500 },
              { quantity: 1, unit_amount: 900 },
            ],
          },
        },
        adminHeaders
      )
      .catch((e: any) => e.response)

    expect(res.status).toBe(201)
    expect(res.data.payment_submission.total_amount).toBe(1900)
  })
})
