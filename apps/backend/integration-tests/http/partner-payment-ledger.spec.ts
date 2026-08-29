/**
 * The merged partner payment ledger (#1612).
 *
 *   GET /admin/payments/partners/:id/ledger
 *
 * ## Why this is an integration test and not more unit tests
 *
 * `foldPartnerLedger` is unit-tested against prod-shaped rows. What those tests
 * cannot show is that the three reads behind the route actually reach the same
 * partner: submissions come from the module service, `internal_payments` from a
 * LINK graph, and the settlement join from a third module's reconciliations.
 * The whole defect this closes is a surface that reads one record and looks
 * complete, so "does the route see both records" is precisely the thing that
 * has to be exercised against a real database.
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

  // ─── the cases ────────────────────────────────────────────────────────────

  it("renders a payout that has no internal_payments row behind it", async () => {
    // Since #1638 approval writes no payment row, so this is EVERY payout made
    // since. A panel reading `internal_payments` alone shows nothing here.
    const partnerId = await createPartner("payout-only")
    const designId = await createDesign(`Ledger payout only ${Date.now()}`, partnerId)
    const submission = await createSubmission(partnerId, designId)

    const { entries, totals, count } = await ledger(partnerId)

    expect(count).toBe(1)
    expect(entries[0].kind).toBe("payout")
    expect(entries[0].submission_id).toBe(submission.id)
    expect(totals.billed).toBe(1000)
    expect(totals.outstanding).toBe(1000)
    expect(totals.paid).toBe(0)
  })

  it("renders a historical payment, and keeps it out of `paid`", async () => {
    const partnerId = await createPartner("payment-only")
    await createLinkedPayment(partnerId, 18000)

    const { entries, totals } = await ledger(partnerId)

    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("payment")
    expect(totals.recorded).toBe(18000)
    // History, not a settled payout. Adding it to `paid` would describe money
    // no submission ever claimed as though a payout existed for it.
    expect(totals.paid).toBe(0)
    expect(totals.billed).toBe(0)
  })

  it("renders BOTH records for one partner — the defect this closes", async () => {
    // The two panels this replaces each showed one of these and neither said so.
    const partnerId = await createPartner("both")
    const designId = await createDesign(`Ledger both ${Date.now()}`, partnerId)
    await createSubmission(partnerId, designId)
    await createLinkedPayment(partnerId, 18000)

    const { entries } = await ledger(partnerId)

    expect(entries).toHaveLength(2)
    expect(entries.map((e: any) => e.kind).sort()).toEqual([
      "payment",
      "payout",
    ])
  })

  it("🔴 attaches a settled payment to its payout instead of counting it twice", async () => {
    // The prod shape: 5 reconciliations, each naming a submission AND a
    // payment. Rendering both rows would double every total on the panel.
    const partnerId = await createPartner("settled")
    const designId = await createDesign(`Ledger settled ${Date.now()}`, partnerId)
    const submission = await createSubmission(partnerId, designId)
    const paymentId = await createLinkedPayment(partnerId, 1000)

    const rec = await api.post(
      "/admin/payment_reports/reconciliation",
      {
        reference_type: "payment_submission",
        reference_id: submission.id,
        partner_id: partnerId,
        expected_amount: 1000,
        payment_id: paymentId,
      },
      adminHeaders
    )
    expect(rec.status).toBe(201)

    const { entries, totals } = await ledger(partnerId)

    // ONE entry for one payout — not a payout plus a payment for the same 1000.
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("payout")
    expect(entries[0].settled_by?.payment_id).toBe(paymentId)
    expect(totals.recorded).toBe(0)
  })

  it("does not attach a payment whose reconciliation names another partner's payout", async () => {
    // The reconciliation read is scoped by submission id; a stray row must not
    // silently remove a payment this partner really has.
    const [partnerA, partnerB] = [
      await createPartner("cross-a"),
      await createPartner("cross-b"),
    ]
    const designId = await createDesign(`Ledger cross ${Date.now()}`, partnerA)
    const submissionA = await createSubmission(partnerA, designId)
    const paymentB = await createLinkedPayment(partnerB, 5000)

    await api.post(
      "/admin/payment_reports/reconciliation",
      {
        reference_type: "payment_submission",
        reference_id: submissionA.id,
        partner_id: partnerA,
        expected_amount: 5000,
        payment_id: paymentB,
      },
      adminHeaders
    )

    const { entries, totals } = await ledger(partnerB)

    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("payment")
    expect(totals.recorded).toBe(5000)
  })

  it("excludes a Rejected payout from both totals but still renders it", async () => {
    // 1 of the 20 submissions on prod is Rejected. A rejected claim paid nobody
    // and is not owed either.
    const partnerId = await createPartner("rejected")
    const designId = await createDesign(`Ledger rejected ${Date.now()}`, partnerId)
    const submission = await createSubmission(partnerId, designId, {
      status: "Pending",
    })

    const review = await api.post(
      `/admin/payment-submissions/${submission.id}/review`,
      { action: "reject", rejection_reason: "Duplicate claim" },
      adminHeaders
    )
    expect(review.status).toBe(200)

    const { entries, totals } = await ledger(partnerId)

    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe("Rejected")
    expect(totals.billed).toBe(0)
    expect(totals.outstanding).toBe(0)
  })

  it("answers for a partner with nothing at all, rather than erroring", async () => {
    const partnerId = await createPartner("empty")

    const { entries, totals, count } = await ledger(partnerId)

    expect(count).toBe(0)
    expect(entries).toEqual([])
    expect(totals.billed).toBe(0)
    expect(totals.recorded).toBe(0)
  })

  it("carries the payout's source lines so the panel can label them", async () => {
    const partnerId = await createPartner("lines")
    const designId = await createDesign(`Ledger lines ${Date.now()}`, partnerId)
    await createSubmission(partnerId, designId)

    const { entries } = await ledger(partnerId)

    expect(entries[0].lines).toHaveLength(1)
    expect(entries[0].lines[0].design_id).toBe(designId)
    // Only the source descriptors cross the boundary — never the amounts, so a
    // screen cannot re-derive a total from the lines (#1596/#1637).
    expect(entries[0].lines[0]).not.toHaveProperty("amount")
    expect(entries[0].lines[0]).not.toHaveProperty("unit_amount")
  })
})
