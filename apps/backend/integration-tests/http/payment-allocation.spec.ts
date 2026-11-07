/**
 * One payment split across several payouts, with named shares (#2523).
 *
 *   POST   /admin/payments/:id/settles   { payment_submission_id, amount? }
 *   DELETE /admin/payments/:id/settles?payment_submission_id=
 *   POST   /admin/payments/link          { ..., allocations: [...] }
 *   POST   /admin/partners/:id/credits/:creditId/apply
 *
 * HR Handloom, 2026-11-05: 25,000 paid "against the total" of three bills. The
 * fold could already spread a payment oldest-first; these cases prove the
 * routes write a named share, refuse one the payment cannot cover, and that
 * the credit check reads each payout's SHARE rather than the whole payment.
 *
 * ⚠️ The shared-DB runner restores a snapshot before every test, so each case
 * builds its own partner.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  let adminHeaders: any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    adminHeaders = await getAuthHeaders(api)
  })

  // ─── fixtures ─────────────────────────────────────────────────────────────

  async function createPartner(label: string) {
    const unique = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const email = `ledger-${unique}@jyt.test`
    const password = "supersecret"

    await api.post("/auth/partner/emailpass/register", { email, password })
    const login = await api.post("/auth/partner/emailpass", { email, password })
    const partnerHeaders = { Authorization: `Bearer ${login.data.token}` }

    const res = await api.post(
      "/partners",
      {
        name: `Ledger ${unique}`,
        handle: `ledger-${unique}`,
        admin: { email, first_name: "Ledger", last_name: "Partner" },
      },
      { headers: partnerHeaders }
    )
    expect(res.status).toBe(200)

    return res.data.partner.id as string
  }

  async function createDesign(name: string, partnerId: string) {
    const res = await api.post(
      "/admin/designs",
      {
        name,
        description: `Ledger design ${name}`,
        design_type: "Original",
        status: "Commerce_Ready",
        priority: "Medium",
        estimated_cost: 1000,
        cost_currency: "inr",
      },
      adminHeaders
    )
    expect(res.status).toBe(201)
    const designId = res.data.design.id as string
    await linkDesignToPartner(designId, partnerId)
    return designId
  }

  /**
   * A design only becomes claimable once it is the partner's. The submission
   * workflow checks ownership, so a design created and never linked is a 400
   * that has nothing to do with the ledger.
   */
  async function linkDesignToPartner(designId: string, partnerId: string) {
    const remoteLink = getContainer().resolve(
      ContainerRegistrationKeys.LINK
    ) as any
    await remoteLink.create({
      design: { design_id: designId },
      partner: { partner_id: partnerId },
    })
  }

  /** A payout, as an admin-created submission for one design. */
  async function createSubmission(
    partnerId: string,
    designId: string,
    overrides: Record<string, any> = {}
  ) {
    const res = await api.post(
      "/admin/payment-submissions",
      {
        partner_id: partnerId,
        design_ids: [designId],
        cost_overrides: { [designId]: 1000 },
        ...overrides,
      },
      adminHeaders
    )
    expect(res.status).toBe(201)
    return res.data.payment_submission
  }

  /** A historical `internal_payments` row, linked to the partner. */
  async function createLinkedPayment(partnerId: string, amount: number) {
    const res = await api.post(
      "/admin/payments/link",
      {
        payment: {
          amount,
          // Only Completed money settles a payout.
          status: "Completed",
          payment_type: "Bank",
          payment_date: new Date("2025-09-23T18:30:00.000Z").toISOString(),
        },
        partnerIds: [partnerId],
      },
      adminHeaders
    )
    expect(res.status).toBe(201)
    return (res.data.payment?.id || res.data.result?.id) as string
  }

  const ledger = async (partnerId: string) => {
    const res = await api.get(
      `/admin/payments/partners/${partnerId}/ledger`,
      adminHeaders
    )
    expect(res.status).toBe(200)
    return res.data
  }

  const settledById = (data: any) =>
    Object.fromEntries(
      data.entries
        .filter((e: any) => e.kind === "payout")
        .map((e: any) => [e.submission_id, e.settled_amount])
    )

  /** Two 1,000 payouts, the first one older, and a 1,500 payment. */
  async function twoPayoutsAndAPayment(label: string) {
    const partnerId = await createPartner(label)
    const older = await createSubmission(partnerId, await createDesign(`${label}-a`, partnerId))
    const newer = await createSubmission(partnerId, await createDesign(`${label}-b`, partnerId))
    const paymentId = await createLinkedPayment(partnerId, 1500)
    return { partnerId, older: older.id as string, newer: newer.id as string, paymentId }
  }

  const settle = (paymentId: string, body: Record<string, any>) =>
    api
      .post(`/admin/payments/${paymentId}/settles`, body, adminHeaders)
      .catch((e: any) => e.response)

  it("spends a named share instead of oldest-first, and shows what is left", async () => {
    const { partnerId, older, newer, paymentId } = await twoPayoutsAndAPayment("named")

    expect((await settle(paymentId, { payment_submission_id: newer, amount: 1000 })).status).toBe(200)
    const second = await settle(paymentId, { payment_submission_id: older, amount: 300 })
    expect(second.status).toBe(200)

    const data = await ledger(partnerId)
    expect(settledById(data)).toEqual({ [older]: 300, [newer]: 1000 })
    expect(data.totals.paid).toBe(1300)
    expect(data.totals.unallocated).toBe(200)
    expect(data.totals.unallocated_payments).toEqual([
      { payment_id: paymentId, amount: 1500, unallocated: 200 },
    ])
  })

  it("refuses a share the payment cannot cover, and writes nothing", async () => {
    const { partnerId, older, newer, paymentId } = await twoPayoutsAndAPayment("over")

    expect((await settle(paymentId, { payment_submission_id: older, amount: 1000 })).status).toBe(200)
    const refused = await settle(paymentId, { payment_submission_id: newer, amount: 600 })
    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(refused.data)).toContain("only 500 is left")

    // The refused share wrote no link either: the newer payout is untouched.
    expect(settledById(await ledger(partnerId))).toEqual({ [older]: 1000, [newer]: 0 })
  })

  it("drops the named share when the link is removed", async () => {
    const { partnerId, older, newer, paymentId } = await twoPayoutsAndAPayment("unlink")

    await settle(paymentId, { payment_submission_id: older, amount: 200 })
    await settle(paymentId, { payment_submission_id: newer, amount: 1000 })
    const del = await api.delete(
      `/admin/payments/${paymentId}/settles?payment_submission_id=${newer}`,
      adminHeaders
    )
    expect(del.status).toBe(200)

    // Re-linking WITHOUT an amount must not resurrect the old 1,000 share:
    // the payment's other 1,300 now goes oldest-first, capped at the payout.
    await settle(paymentId, { payment_submission_id: newer })
    expect(settledById(await ledger(partnerId))).toEqual({ [older]: 200, [newer]: 1000 })
  })

  it("records a payment and its split in one call", async () => {
    const partnerId = await createPartner("create-split")
    const older = await createSubmission(partnerId, await createDesign("cs-a", partnerId))
    const newer = await createSubmission(partnerId, await createDesign("cs-b", partnerId))

    const res = await api.post(
      "/admin/payments/link",
      {
        payment: {
          amount: 1500,
          status: "Completed",
          payment_type: "Bank",
          payment_date: new Date("2026-11-05T00:00:00.000Z").toISOString(),
        },
        partnerIds: [partnerId],
        allocations: [
          { payment_submission_id: newer.id, amount: 900 },
          { payment_submission_id: older.id, amount: 600 },
        ],
      },
      adminHeaders
    )
    expect(res.status).toBe(201)
    expect(settledById(await ledger(partnerId))).toEqual({ [older.id]: 600, [newer.id]: 900 })
  })

  it("refuses a split that adds up to more than the payment, before writing it", async () => {
    const partnerId = await createPartner("create-over")
    const older = await createSubmission(partnerId, await createDesign("co-a", partnerId))
    const newer = await createSubmission(partnerId, await createDesign("co-b", partnerId))

    const res = await api
      .post(
        "/admin/payments/link",
        {
          payment: {
            amount: 1500,
            status: "Completed",
            payment_type: "Bank",
            payment_date: new Date("2026-11-05T00:00:00.000Z").toISOString(),
          },
          partnerIds: [partnerId],
          allocations: [
            { payment_submission_id: older.id, amount: 1000 },
            { payment_submission_id: newer.id, amount: 1000 },
          ],
        },
        adminHeaders
      )
      .catch((e: any) => e.response)
    expect(res.status).toBeGreaterThanOrEqual(400)

    const data = await ledger(partnerId)
    expect(data.totals.paid).toBe(0)
    expect(data.entries.filter((e: any) => e.kind === "payment")).toHaveLength(0)
  })

  /**
   * 🔴 The bug found while scoping #2523. The credit check summed the WHOLE
   * payment against each payout it was linked to, so the newer payout read as
   * 1,500 settled (nothing left) and this 400 credit was refused, though only
   * 500 of the payment went there.
   */
  it("checks a credit against the payout's share of a split payment", async () => {
    const { partnerId, older, newer, paymentId } = await twoPayoutsAndAPayment("credit")
    await settle(paymentId, { payment_submission_id: older })
    await settle(paymentId, { payment_submission_id: newer })
    expect(settledById(await ledger(partnerId))).toEqual({ [older]: 1000, [newer]: 500 })

    const credit = await api.post(
      `/admin/partners/${partnerId}/credits`,
      { amount: 400, source_type: "adjustment", reason: "integration test (#2523)" },
      adminHeaders
    )
    const applied = await api
      .post(
        `/admin/partners/${partnerId}/credits/${credit.data.credit.id}/apply`,
        { submission_id: newer },
        adminHeaders
      )
      .catch((e: any) => e.response)
    expect(applied.status).toBe(200)
    expect(applied.data.remaining_after).toBe(100)
  })
})
