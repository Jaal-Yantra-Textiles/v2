/**
 * Applying a partner credit to a payout, and reading its earmark (#1712).
 *
 *   GET  /admin/partners/:id/credits
 *   POST /admin/partners/:id/credits/:creditId/apply
 *
 * ## Why these are integration tests and not more unit tests
 *
 * `checkCreditApplicable` and `foldPartnerLedger` are unit-tested against
 * prod-shaped rows. What those cannot show is the part that actually bites:
 *
 *  - `partner_credit` has NO partner column. Both the read and the apply reach
 *    it through a link, and a link that writes fine and reads empty is this
 *    codebase's most expensive recurring bug. A guard that silently sees no
 *    rows refuses nothing.
 *  - the earmark is a SECOND link, written by the create route and — until
 *    this change — exposed by no read at all. `partner_credit.*` selects
 *    columns, so the field was simply absent rather than null.
 *  - the ledger's `credited` has to move after the write. A fold that computes
 *    it from credits the route never fetched is dead code, and the apply would
 *    stamp a decision no screen honours.
 *
 * ⚠️ The shared-DB runner restores a snapshot before every test, so each case
 * builds its own partner. Do not thread state between them.
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
    const email = `credit-${unique}@jyt.test`
    const password = "supersecret"

    await api.post("/auth/partner/emailpass/register", { email, password })
    const login = await api.post("/auth/partner/emailpass", { email, password })
    const partnerHeaders = { Authorization: `Bearer ${login.data.token}` }

    const res = await api.post(
      "/partners",
      {
        name: `Credit ${unique}`,
        handle: `credit-${unique}`,
        admin: { email, first_name: "Credit", last_name: "Partner" },
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
        description: `Credit design ${name}`,
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

    const remoteLink = getContainer().resolve(
      ContainerRegistrationKeys.LINK
    ) as any
    await remoteLink.create({
      design: { design_id: designId },
      partner: { partner_id: partnerId },
    })
    return designId
  }

  /** A payout worth `amount`, as an admin-created submission for one design. */
  async function createSubmission(
    partnerId: string,
    designId: string,
    amount = 1000
  ) {
    const res = await api.post(
      "/admin/payment-submissions",
      {
        partner_id: partnerId,
        design_ids: [designId],
        cost_overrides: { [designId]: amount },
      },
      adminHeaders
    )
    expect(res.status).toBe(201)
    return res.data.payment_submission
  }

  async function createCredit(
    partnerId: string,
    body: Record<string, any>
  ) {
    const res = await api.post(
      `/admin/partners/${partnerId}/credits`,
      {
        amount: 380,
        reason: "Overpaid against an earlier payout",
        ...body,
      },
      adminHeaders
    )
    expect(res.status).toBe(201)
    return res.data.credit
  }

  const listCredits = async (partnerId: string) => {
    const res = await api.get(
      `/admin/partners/${partnerId}/credits`,
      adminHeaders
    )
    expect(res.status).toBe(200)
    return res.data
  }

  const ledger = async (partnerId: string) => {
    const res = await api.get(
      `/admin/payments/partners/${partnerId}/ledger`,
      adminHeaders
    )
    expect(res.status).toBe(200)
    return res.data
  }

  const apply = (partnerId: string, creditId: string, body: any) =>
    api
      .post(
        `/admin/partners/${partnerId}/credits/${creditId}/apply`,
        body,
        adminHeaders
      )
      .catch((e: any) => e.response)

  // ─── the earmark ──────────────────────────────────────────────────────────

  /**
   * 🔴 The gap this closes. The create route writes TWO links and the read
   * exposed only one, so "this credit is earmarked against order X" was a fact
   * the database held and no surface showed.
   */
  it("exposes the order a credit is earmarked against", async () => {
    const partnerId = await createPartner("earmark")

    /**
     * ⚠️ A synthetic order id on purpose. The earmark is a LINK ROW and the
     * read never joins through to the order, so building a real inventory
     * order (which needs an inventory item and two stock locations) would test
     * the order fixture rather than the thing that was broken — that the second
     * link the create route writes is exposed by a read at all.
     */
    const orderId = `ord_earmark_${Date.now()}`

    const credit = await createCredit(partnerId, {
      amount: 1380,
      reason: "Paid 30,000 against a 28,620 payout",
      inventory_order_id: orderId,
    })

    const { credits, open_total } = await listCredits(partnerId)
    const row = credits.find((c: any) => c.id === credit.id)

    expect(row.inventory_order_id).toBe(orderId)
    expect(open_total).toBe(1380)
  })

  /** A partner-wide credit reads as null, never as a missing field. */
  it("reports no earmark as null rather than omitting the field", async () => {
    const partnerId = await createPartner("no-earmark")
    await createCredit(partnerId, { amount: 500 })

    const { credits } = await listCredits(partnerId)
    expect(credits).toHaveLength(1)
    expect(credits[0]).toHaveProperty("inventory_order_id")
    expect(credits[0].inventory_order_id).toBeNull()
  })

  // ─── applying ─────────────────────────────────────────────────────────────

  it("applies a credit and moves the ledger's outstanding, not its paid", async () => {
    const partnerId = await createPartner("apply")
    const designId = await createDesign(`Credit apply ${Date.now()}`, partnerId)
    const submission = await createSubmission(partnerId, designId, 1000)
    const credit = await createCredit(partnerId, { amount: 380 })

    const before = await ledger(partnerId)
    expect(before.totals.outstanding).toBe(1000)
    expect(before.totals.credited).toBe(0)

    const res = await apply(partnerId, credit.id, {
      submission_id: submission.id,
    })
    expect(res.status).toBe(200)
    expect(res.data.remaining_before).toBe(1000)
    expect(res.data.remaining_after).toBe(620)
    expect(res.data.credit.status).toBe("Applied")
    expect(res.data.credit.applied_to_submission_id).toBe(submission.id)
    expect(res.data.credit.applied_at).toBeTruthy()

    const after = await ledger(partnerId)
    expect(after.totals.credited).toBe(380)
    expect(after.totals.outstanding).toBe(620)
    /**
     * 🔑 `paid` means money that TRANSFERRED. A founder reconciling this screen
     * against a bank statement must not find a figure no statement explains.
     */
    expect(after.totals.paid).toBe(0)

    const payout = after.entries.find((e: any) => e.kind === "payout")
    expect(payout.credited_amount).toBe(380)
    expect(payout.credits_applied[0].credit_id).toBe(credit.id)
  })

  /** An Applied credit has been consumed — offering it again offers it twice. */
  it("drops an applied credit out of open_total", async () => {
    const partnerId = await createPartner("open-total")
    const designId = await createDesign(`Credit open ${Date.now()}`, partnerId)
    const submission = await createSubmission(partnerId, designId, 1000)
    const credit = await createCredit(partnerId, { amount: 380 })

    expect((await listCredits(partnerId)).open_total).toBe(380)
    expect((await apply(partnerId, credit.id, { submission_id: submission.id })).status).toBe(200)

    const after = await listCredits(partnerId)
    expect(after.open_total).toBe(0)
    expect(after.count).toBe(1)
  })

  it("refuses to apply the same credit twice", async () => {
    const partnerId = await createPartner("twice")
    const designId = await createDesign(`Credit twice ${Date.now()}`, partnerId)
    const first = await createSubmission(partnerId, designId, 1000)
    const credit = await createCredit(partnerId, { amount: 380 })

    expect((await apply(partnerId, credit.id, { submission_id: first.id })).status).toBe(200)

    const second = await apply(partnerId, credit.id, {
      submission_id: first.id,
    })
    expect(second.status).toBe(400)
    expect(String(second.data.message)).toContain("Applied")
  })

  /**
   * 🔴 A silent clamp is what hid the 1,380 in the first place. A credit
   * applies whole, so one larger than the remaining claim is refused with both
   * numbers named — not quietly consumed down to the remainder.
   */
  it("refuses a credit larger than what the payout still claims, naming both numbers", async () => {
    const partnerId = await createPartner("too-big")
    const designId = await createDesign(`Credit big ${Date.now()}`, partnerId)
    const submission = await createSubmission(partnerId, designId, 1000)
    const credit = await createCredit(partnerId, { amount: 5000 })

    const res = await apply(partnerId, credit.id, {
      submission_id: submission.id,
    })
    expect(res.status).toBe(400)
    expect(String(res.data.message)).toContain("5000")
    expect(String(res.data.message)).toContain("1000")

    // And nothing moved.
    expect((await ledger(partnerId)).totals.outstanding).toBe(1000)
    expect((await listCredits(partnerId)).open_total).toBe(5000)
  })

  /**
   * 🔴 Both ends of the request are checked. `partner_credit` has no partner
   * column, so an id alone would happily apply another partner's money — the
   * shape that rendered every partner's quote on every storefront.
   */
  it("refuses a credit that belongs to a DIFFERENT partner", async () => {
    const owner = await createPartner("owner")
    const stranger = await createPartner("stranger")
    const designId = await createDesign(`Credit cross ${Date.now()}`, stranger)
    const submission = await createSubmission(stranger, designId, 1000)
    const credit = await createCredit(owner, { amount: 380 })

    const res = await apply(stranger, credit.id, {
      submission_id: submission.id,
    })
    expect(res.status).toBe(404)

    // The owner still holds it, untouched.
    expect((await listCredits(owner)).open_total).toBe(380)
  })

  /** The other end: a payout belonging to someone else is a 404, not a discharge. */
  it("refuses a payout that belongs to a DIFFERENT partner", async () => {
    const holder = await createPartner("holder")
    const other = await createPartner("other")
    const designId = await createDesign(`Credit other ${Date.now()}`, other)
    const submission = await createSubmission(other, designId, 1000)
    const credit = await createCredit(holder, { amount: 380 })

    const res = await apply(holder, credit.id, {
      submission_id: submission.id,
    })
    expect(res.status).toBe(404)
    expect((await listCredits(holder)).open_total).toBe(380)
  })

  it("requires a submission_id — a credit applied to nobody's payout reduces nothing", async () => {
    const partnerId = await createPartner("no-submission")
    const credit = await createCredit(partnerId, { amount: 380 })

    const res = await apply(partnerId, credit.id, {})
    expect(res.status).toBe(400)
  })
})
