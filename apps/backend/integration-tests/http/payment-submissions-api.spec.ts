/**
 * Integration tests for Design Payment Submissions & Reconciliation
 *
 * Covers:
 *   POST   /partners/payment-submissions              — create payment submission
 *   GET    /partners/payment-submissions              — list own submissions
 *   GET    /partners/payment-submissions/:submissionId — get detail
 *   GET    /admin/payment-submissions                  — admin list all
 *   GET    /admin/payment-submissions/:id              — admin detail
 *   POST   /admin/payment-submissions/:id/review       — approve / reject
 *   GET    /admin/payment_reports/reconciliation        — list reconciliations
 *   POST   /admin/payment_reports/reconciliation        — manual reconciliation
 *   GET    /admin/payment_reports/reconciliation/:id    — get reconciliation
 *   PATCH  /admin/payment_reports/reconciliation/:id    — update reconciliation
 *   POST   /admin/payment_reports/reconciliation/:id/settle — settle reconciliation
 *   GET    /admin/payment_reports/summary?include_reconciliation=true — reconciliation in summary
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  let adminHeaders: any
  let partnerId: string
  let partnerHeaders: any
  let paidToId: string

  const { api, getContainer } = getSharedTestEnv()

  // ─── Setup ────────────────────────────────────────────────────────────────

  async function createPartnerWithAuth(unique: number) {
    const email = `ps-partner-${unique}-${Date.now()}@jyt.test`
    const pw = "supersecret"

    await api.post("/auth/partner/emailpass/register", { email, password: pw })
    let lr = await api.post("/auth/partner/emailpass", { email, password: pw })
    let h = { Authorization: `Bearer ${lr.data.token}` }

    const res = await api.post(
      "/partners",
      {
        name: `PS Partner ${unique}`,
        handle: `ps-partner-${unique}-${Date.now()}`,
        admin: { email, first_name: "Test", last_name: "Partner" },
      },
      { headers: h }
    )
    expect(res.status).toBe(200)

    // Re-login to get updated token with partner entity
    lr = await api.post("/auth/partner/emailpass", { email, password: pw })
    h = { Authorization: `Bearer ${lr.data.token}` }

    return { partnerId: res.data.partner.id, partnerHeaders: h }
  }

  async function createDesign(
    name: string,
    overrides: Record<string, any> = {}
  ) {
    const res = await api.post(
      "/admin/designs",
      {
        name,
        description: `Test design ${name}`,
        design_type: "Original",
        status: "Commerce_Ready",
        priority: "Medium",
        estimated_cost: 5000,
        cost_currency: "inr",
        ...overrides,
      },
      adminHeaders
    )
    expect(res.status).toBe(201)
    return res.data.design.id as string
  }

  async function linkDesignToPartner(designId: string, pId: string) {
    const container = getContainer()
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as any
    await remoteLink.create({
      design: { design_id: designId },
      partner: { partner_id: pId },
    })
  }

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    adminHeaders = await getAuthHeaders(api)

    const result = await createPartnerWithAuth(
      Math.floor(Math.random() * 100000)
    )
    partnerId = result.partnerId
    partnerHeaders = result.partnerHeaders

    // Create a payment method for the partner (needed for approval flow)
    const methodRes = await api.post(
      `/admin/payments/partners/${partnerId}/methods`,
      {
        type: "bank_account",
        account_name: "Test Bank Account",
        bank_name: "Test Bank",
      },
      adminHeaders
    )
    paidToId = methodRes.data.paymentMethod.id
  })

  // ─── Partner: Create Payment Submission ───────────────────────────────────

  describe("POST /partners/payment-submissions", () => {
    it("should create a payment submission for eligible designs", async () => {
      const d1 = await createDesign("PS Design 1")
      const d2 = await createDesign("PS Design 2", { estimated_cost: 3000 })
      await linkDesignToPartner(d1, partnerId)
      await linkDesignToPartner(d2, partnerId)

      const res = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1, d2], notes: "Monthly batch" },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      const { payment_submission } = res.data
      expect(payment_submission).toBeDefined()
      expect(payment_submission.id).toBeDefined()
      expect(payment_submission.status).toBe("Pending")
      expect(payment_submission.partner_id).toBe(partnerId)
      expect(Number(payment_submission.total_amount)).toBe(8000) // 5000 + 3000
      expect(payment_submission.notes).toBe("Monthly batch")
      expect(payment_submission.submitted_at).toBeDefined()
    })

    it("should reject designs not in eligible status", async () => {
      const d1 = await createDesign("Ineligible Design", {
        status: "Conceptual",
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api
        .post(
          "/partners/payment-submissions",
          { design_ids: [d1] },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(res.data.message || res.data.error || "").toMatch(
        /not eligible|status must be/i
      )
    })

    it("should reject designs not assigned to the partner", async () => {
      const d1 = await createDesign("Unowned Design")
      // Intentionally NOT linking to the partner

      const res = await api
        .post(
          "/partners/payment-submissions",
          { design_ids: [d1] },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.data.message || res.data.error || "").toMatch(
        /not assigned|not.*partner/i
      )
    })

    it("should reject designs missing estimated_cost", async () => {
      const d1 = await createDesign("No Cost Design", {
        estimated_cost: undefined,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api
        .post(
          "/partners/payment-submissions",
          { design_ids: [d1] },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.data.message || res.data.error || "").toMatch(
        /missing cost/i
      )
    })

    it("should honor a partner-entered cost override for a design missing cost", async () => {
      const d1 = await createDesign("Override No Cost Design", {
        estimated_cost: undefined,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/partners/payment-submissions",
        {
          design_ids: [d1],
          metadata: { design_cost_overrides: { [d1]: 4200 } },
        },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(4200)
    })

    it("should prefer the cost override over the stored design cost", async () => {
      const d1 = await createDesign("Override Stored Cost Design", {
        estimated_cost: 5000,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/partners/payment-submissions",
        {
          design_ids: [d1],
          metadata: { design_cost_overrides: { [d1]: 6500 } },
        },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(6500)
    })

    it("should honor a partner-entered cost override for a completed task missing cost", async () => {
      const container = getContainer()
      const taskService = container.resolve("tasks") as any
      const task = await taskService.createTasks({
        title: "No Cost Completed Task",
        status: "completed",
        start_date: new Date(),
      })
      const remoteLink = container.resolve(
        ContainerRegistrationKeys.LINK
      ) as any
      await remoteLink.create({
        partner: { partner_id: partnerId },
        tasks: { task_id: task.id },
      })

      // Without an override the submission is rejected for missing cost
      const rejected = await api
        .post(
          "/partners/payment-submissions",
          { task_ids: [task.id] },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)
      expect(rejected.status).toBeGreaterThanOrEqual(400)
      expect(rejected.data.message || rejected.data.error || "").toMatch(
        /missing cost/i
      )

      // With the override the submission succeeds using the entered amount
      const res = await api.post(
        "/partners/payment-submissions",
        {
          task_ids: [task.id],
          metadata: { task_cost_overrides: { [task.id]: 1500 } },
        },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(1500)
    })

    it("should reject designs already in an active submission", async () => {
      const d1 = await createDesign("Duplicate Sub Design")
      await linkDesignToPartner(d1, partnerId)

      // First submission — should succeed
      const first = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )
      expect(first.status).toBe(201)

      // Second submission with same design — should fail
      const second = await api
        .post(
          "/partners/payment-submissions",
          { design_ids: [d1] },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(second.status).toBeGreaterThanOrEqual(400)
      expect(second.data.message || second.data.error || "").toMatch(
        /already in.*submission/i
      )
    })

    it("should reject empty design_ids", async () => {
      const res = await api
        .post(
          "/partners/payment-submissions",
          { design_ids: [] },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })

    it("should reject unauthenticated requests", async () => {
      const res = await api
        .post("/partners/payment-submissions", { design_ids: ["fake"] })
        .catch((e: any) => e.response)

      expect([401, 403]).toContain(res.status)
    })
  })

  // ─── Partner: List Submissions ────────────────────────────────────────────

  describe("GET /partners/payment-submissions", () => {
    it("should list submissions for the authenticated partner", async () => {
      const d1 = await createDesign("List Design")
      await linkDesignToPartner(d1, partnerId)

      await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )

      const res = await api.get("/partners/payment-submissions", {
        headers: partnerHeaders,
      })

      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.payment_submissions)).toBe(true)
      expect(res.data.count).toBeGreaterThanOrEqual(1)
      expect(res.data.payment_submissions[0].partner_id).toBe(partnerId)
    })

    it("should filter by status", async () => {
      const d1 = await createDesign("Filter Design")
      await linkDesignToPartner(d1, partnerId)

      await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )

      const res = await api.get("/partners/payment-submissions", {
        headers: partnerHeaders,
        params: { status: "Pending" },
      })

      expect(res.status).toBe(200)
      res.data.payment_submissions.forEach((s: any) => {
        expect(s.status).toBe("Pending")
      })
    })
  })

  // ─── Partner: Get Submission Detail ───────────────────────────────────────

  describe("GET /partners/payment-submissions/:submissionId", () => {
    it("should return submission with items", async () => {
      const d1 = await createDesign("Detail Design 1", { estimated_cost: 7000 })
      const d2 = await createDesign("Detail Design 2", { estimated_cost: 3000 })
      await linkDesignToPartner(d1, partnerId)
      await linkDesignToPartner(d2, partnerId)

      const createRes = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1, d2] },
        { headers: partnerHeaders }
      )
      const submissionId = createRes.data.payment_submission.id

      const res = await api.get(
        `/partners/payment-submissions/${submissionId}`,
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(200)
      const { payment_submission } = res.data
      expect(payment_submission.id).toBe(submissionId)
      expect(payment_submission.items).toBeDefined()
      expect(payment_submission.items.length).toBe(2)

      const amounts = payment_submission.items.map((i: any) =>
        Number(i.amount)
      )
      expect(amounts).toContain(7000)
      expect(amounts).toContain(3000)
    })
  })

  // ─── Admin: Create Submission (typed money fields) ────────────────────────

  /**
   * The money contract as REQUEST FIELDS rather than `metadata` keys.
   *
   * Every one of these used to travel inside `metadata`, which each route
   * validates as `z.record(z.string(), z.any())` — a shape that accepts
   * anything. `design_quantities` and `design_quantites` both validated, and
   * the typo fell through to the workflow's documented "absent means 1"
   * default and billed a per-unit rate once (#1554). Nothing could catch that:
   * not tsc, not a unit test, not a reviewer reading the diff.
   *
   * These tests are written against the HTTP surface on purpose. The unit tests
   * cover the folding function; only an integration test proves the field
   * survives the validator, the route and the workflow and lands on the money.
   */
  describe("POST /admin/payment-submissions — typed money fields", () => {
    it("bills quantity x unit rate and records the breakdown", async () => {
      // The live case: a design costed per-unit, produced nine times. Before
      // the fix this billed 850.
      const d1 = await createDesign("Admin Qty Design", {
        estimated_cost: 1281.2,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 9 },
          unit_amounts: { [d1]: 850 },
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(7650)

      const detail = await api.get(
        `/admin/payment-submissions/${res.data.payment_submission.id}`,
        adminHeaders
      )
      const item = detail.data.payment_submission.items[0]
      // The rate must survive as its own field. A reader wanting "9 x 850"
      // must not have to divide the total by the quantity and hope.
      expect(Number(item.quantity)).toBe(9)
      expect(Number(item.unit_amount)).toBe(850)
    })

    it("prefers the supplied rate over the design's stored cost", async () => {
      // `partner_cost_estimate` on the run is what was AGREED; the design's
      // stored estimate routinely disagrees with it. Pricing off the design
      // would have billed 1281.2 x 9 here instead of 850 x 9.
      const d1 = await createDesign("Admin Rate Beats Stored", {
        estimated_cost: 1281.2,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 2 },
          unit_amounts: { [d1]: 1150 },
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(2300)
    })

    it("bills a design with no stored cost at all from the supplied rate", async () => {
      // Denim Trouser on prod: no estimated_cost, no production_cost, and a
      // real agreed rate on the run. Without a supplied rate this is a
      // "Designs missing cost" 400.
      const d1 = await createDesign("Admin No Stored Cost", {
        estimated_cost: undefined,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 2 },
          unit_amounts: { [d1]: 1150 },
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(2300)
    })

    it("leaves the amount unchanged when no quantity is supplied", async () => {
      // 🔴 The guard against re-pricing live callers. With nothing supplied the
      // amount must be byte-for-byte what it was before any of this existed.
      const d1 = await createDesign("Admin No Qty Design", {
        estimated_cost: 5000,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        { partner_id: partnerId, design_ids: [d1] },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(5000)
    })

    it("still honours the legacy metadata channel", async () => {
      // The partner form posts through metadata. This must keep working or the
      // fix breaks the very callers it is protecting.
      const d1 = await createDesign("Admin Legacy Metadata", {
        estimated_cost: 300,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          metadata: { design_quantities: { [d1]: 4 } },
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(1200)
    })

    it("lets the typed field win over a conflicting metadata key", async () => {
      const d1 = await createDesign("Admin Precedence Design", {
        estimated_cost: 100,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 3 },
          metadata: { design_quantities: { [d1]: 9 } },
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      // 3, not 9 — the caller that speaks the typed field owns the map.
      expect(Number(res.data.payment_submission.total_amount)).toBe(300)
    })

    it("rejects a non-positive quantity at the boundary", async () => {
      // The workflow's sanitizer DROPS a zero rather than clamping it, so
      // accepting one here would produce a request that validates and then
      // quietly bills x1. Refusing it makes the mistake visible to the caller.
      const d1 = await createDesign("Admin Zero Qty Design")
      await linkDesignToPartner(d1, partnerId)

      const res = await api
        .post(
          "/admin/payment-submissions",
          {
            partner_id: partnerId,
            design_ids: [d1],
            quantities: { [d1]: 0 },
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })

    it("can land a submission as Draft", async () => {
      // 🔴 Fails on the old route, which never forwarded `status` — an
      // admin-created submission could ONLY ever be Pending.
      const d1 = await createDesign("Admin Draft Design")
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        { partner_id: partnerId, design_ids: [d1], status: "Draft" },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(res.data.payment_submission.status).toBe("Draft")
    })

    it("still defaults to Pending when no status is given", async () => {
      const d1 = await createDesign("Admin Default Status Design")
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        { partner_id: partnerId, design_ids: [d1] },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(res.data.payment_submission.status).toBe("Pending")
    })

    it("refuses an ineligible design by default", async () => {
      const d1 = await createDesign("Admin Gate Design", {
        status: "Technical_Review",
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api
        .post(
          "/admin/payment-submissions",
          { partner_id: partnerId, design_ids: [d1] },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(res.data.message).toContain("not eligible for payment")
    })

    it("pays out an ineligible design when the gate is explicitly waived", async () => {
      // The real fix for the live case: a COMPLETED run on a design still in
      // Technical_Review. The only previous way through was to edit the
      // design's status — changing what the record asserts about technical
      // review in order to release a payment.
      const d1 = await createDesign("Admin Waived Gate Design", {
        status: "Technical_Review",
        estimated_cost: 1200,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 4 },
          require_design_status: false,
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(4800)
    })
  })

  // ─── Partner: typed money fields ──────────────────────────────────────────

  describe("POST /partners/payment-submissions — typed money fields", () => {
    it("honours a typed cost override", async () => {
      const d1 = await createDesign("Partner Typed Override", {
        estimated_cost: undefined,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1], cost_overrides: { [d1]: 4200 } },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(4200)
    })

    it("refuses to let a partner choose the submission's status", async () => {
      // 🔑 A partner may not decide which review state their own claim lands
      // in. The field is absent from the partner schema, and the validator is
      // strict, so this is a rejection rather than a silently ignored field.
      const d1 = await createDesign("Partner Status Attempt")
      await linkDesignToPartner(d1, partnerId)

      const res = await api
        .post(
          "/partners/payment-submissions",
          { design_ids: [d1], status: "Approved" },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })

    it("refuses to let a partner waive the design-eligibility gate", async () => {
      const d1 = await createDesign("Partner Gate Attempt", {
        status: "Technical_Review",
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api
        .post(
          "/partners/payment-submissions",
          { design_ids: [d1], require_design_status: false },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })
  })

  // ─── Admin: List Submissions ──────────────────────────────────────────────

  describe("GET /admin/payment-submissions", () => {
    it("should list all submissions", async () => {
      const d1 = await createDesign("Admin List Design")
      await linkDesignToPartner(d1, partnerId)

      await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )

      const res = await api.get("/admin/payment-submissions", adminHeaders)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.payment_submissions)).toBe(true)
      expect(res.data.count).toBeGreaterThanOrEqual(1)
    })

    it("should filter by partner_id", async () => {
      const d1 = await createDesign("Partner Filter Design")
      await linkDesignToPartner(d1, partnerId)

      await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )

      const res = await api.get("/admin/payment-submissions", {
        ...adminHeaders,
        params: { partner_id: partnerId },
      })

      expect(res.status).toBe(200)
      res.data.payment_submissions.forEach((s: any) => {
        expect(s.partner_id).toBe(partnerId)
      })
    })
  })

  // ─── Admin: Approve Submission ────────────────────────────────────────────

  describe("POST /admin/payment-submissions/:id/review", () => {
    it("should approve a submission and create payment + reconciliation", async () => {
      const d1 = await createDesign("Approve Design", { estimated_cost: 10000 })
      await linkDesignToPartner(d1, partnerId)

      const createRes = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )
      const submissionId = createRes.data.payment_submission.id

      const reviewRes = await api.post(
        `/admin/payment-submissions/${submissionId}/review`,
        {
          action: "approve",
          payment_type: "Bank",
          paid_to_id: paidToId,
        },
        adminHeaders
      )

      expect(reviewRes.status).toBe(200)
      expect(reviewRes.data.payment_submission).toBeDefined()
      expect(reviewRes.data.payment).toBeDefined()
      expect(reviewRes.data.payment.id).toBeDefined()
      expect(Number(reviewRes.data.payment.amount)).toBe(10000)
      expect(reviewRes.data.payment.status).toBe("Pending")

      // Verify submission status is now Paid
      const detail = await api.get(
        `/admin/payment-submissions/${submissionId}`,
        adminHeaders
      )
      expect(detail.data.payment_submission.status).toBe("Paid")
      expect(detail.data.payment_submission.reviewed_at).toBeDefined()
      expect(detail.data.payment_submission.reviewed_by).toBeDefined()

      // Verify reconciliation record was created
      const reconRes = await api.get(
        "/admin/payment_reports/reconciliation",
        adminHeaders
      )
      expect(reconRes.status).toBe(200)
      const recon = reconRes.data.reconciliations.find(
        (r: any) => r.reference_id === submissionId
      )
      expect(recon).toBeDefined()
      expect(recon.reference_type).toBe("payment_submission")
      expect(recon.partner_id).toBe(partnerId)
      expect(recon.status).toBe("Matched") // No override, amounts match
      expect(Number(recon.expected_amount)).toBe(10000)
      expect(Number(recon.actual_amount)).toBe(10000)
      expect(Number(recon.discrepancy)).toBe(0)
    })

    it("should create a discrepant reconciliation when amount_override differs", async () => {
      const d1 = await createDesign("Override Design", { estimated_cost: 8000 })
      await linkDesignToPartner(d1, partnerId)

      const createRes = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )
      const submissionId = createRes.data.payment_submission.id

      const reviewRes = await api.post(
        `/admin/payment-submissions/${submissionId}/review`,
        {
          action: "approve",
          amount_override: 7000,
          payment_type: "Bank",
          paid_to_id: paidToId,
        },
        adminHeaders
      )

      expect(reviewRes.status).toBe(200)
      expect(Number(reviewRes.data.payment.amount)).toBe(7000)

      // Verify reconciliation shows discrepancy
      const reconRes = await api.get(
        "/admin/payment_reports/reconciliation",
        adminHeaders
      )
      const recon = reconRes.data.reconciliations.find(
        (r: any) => r.reference_id === submissionId
      )
      expect(recon).toBeDefined()
      expect(recon.status).toBe("Discrepant")
      expect(Number(recon.expected_amount)).toBe(8000)
      expect(Number(recon.actual_amount)).toBe(7000)
      expect(Number(recon.discrepancy)).toBe(-1000)
    })

    it("should reject a submission with reason", async () => {
      const d1 = await createDesign("Reject Design")
      await linkDesignToPartner(d1, partnerId)

      const createRes = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )
      const submissionId = createRes.data.payment_submission.id

      const reviewRes = await api.post(
        `/admin/payment-submissions/${submissionId}/review`,
        {
          action: "reject",
          rejection_reason: "Incomplete documentation",
        },
        adminHeaders
      )

      expect(reviewRes.status).toBe(200)
      expect(reviewRes.data.payment).toBeNull()

      // Verify status is Rejected
      const detail = await api.get(
        `/admin/payment-submissions/${submissionId}`,
        adminHeaders
      )
      expect(detail.data.payment_submission.status).toBe("Rejected")
      expect(detail.data.payment_submission.rejection_reason).toBe(
        "Incomplete documentation"
      )
    })

    it("should not allow reviewing an already approved submission", async () => {
      const d1 = await createDesign("Already Approved Design")
      await linkDesignToPartner(d1, partnerId)

      const createRes = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )
      const submissionId = createRes.data.payment_submission.id

      // First review: approve
      await api.post(
        `/admin/payment-submissions/${submissionId}/review`,
        { action: "approve", payment_type: "Bank", paid_to_id: paidToId },
        adminHeaders
      )

      // Second review: should fail
      const secondReview = await api
        .post(
          `/admin/payment-submissions/${submissionId}/review`,
          { action: "approve", payment_type: "Bank", paid_to_id: paidToId },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(secondReview.status).toBeGreaterThanOrEqual(400)
      expect(secondReview.data.message || secondReview.data.error || "").toMatch(
        /cannot be reviewed|must be Pending/i
      )
    })

    it("should allow re-submission after rejection", async () => {
      const d1 = await createDesign("Resubmit Design")
      await linkDesignToPartner(d1, partnerId)

      // Create and reject first submission
      const first = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1] },
        { headers: partnerHeaders }
      )
      await api.post(
        `/admin/payment-submissions/${first.data.payment_submission.id}/review`,
        { action: "reject", rejection_reason: "Needs fixes" },
        adminHeaders
      )

      // Second submission with same design should succeed (rejected ≠ active)
      const second = await api.post(
        "/partners/payment-submissions",
        { design_ids: [d1], notes: "Fixed and resubmitted" },
        { headers: partnerHeaders }
      )

      expect(second.status).toBe(201)
      expect(second.data.payment_submission.status).toBe("Pending")
    })
  })

  // ─── Admin: Reconciliation CRUD ───────────────────────────────────────────

  describe("Reconciliation API", () => {
    it("should create a manual reconciliation record", async () => {
      const res = await api.post(
        "/admin/payment_reports/reconciliation",
        {
          reference_type: "manual",
          partner_id: partnerId,
          expected_amount: 5000,
          actual_amount: 5000,
          notes: "Manual reconciliation",
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(res.data.reconciliation).toBeDefined()
      expect(res.data.reconciliation.status).toBe("Matched")
      expect(Number(res.data.reconciliation.discrepancy)).toBe(0)
    })

    it("should create a discrepant manual reconciliation", async () => {
      const res = await api.post(
        "/admin/payment_reports/reconciliation",
        {
          reference_type: "manual",
          expected_amount: 10000,
          actual_amount: 9500,
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(res.data.reconciliation.status).toBe("Discrepant")
      expect(Number(res.data.reconciliation.discrepancy)).toBe(-500)
    })

    it("should create a Pending reconciliation when actual_amount is missing", async () => {
      const res = await api.post(
        "/admin/payment_reports/reconciliation",
        {
          reference_type: "manual",
          expected_amount: 3000,
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(res.data.reconciliation.status).toBe("Pending")
    })

    it("should get a reconciliation by ID", async () => {
      const created = await api.post(
        "/admin/payment_reports/reconciliation",
        {
          reference_type: "manual",
          expected_amount: 1000,
          actual_amount: 1000,
        },
        adminHeaders
      )
      const reconId = created.data.reconciliation.id

      const res = await api.get(
        `/admin/payment_reports/reconciliation/${reconId}`,
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.reconciliation.id).toBe(reconId)
    })

    it("should update a reconciliation's actual_amount and recompute status", async () => {
      const created = await api.post(
        "/admin/payment_reports/reconciliation",
        {
          reference_type: "manual",
          expected_amount: 5000,
        },
        adminHeaders
      )
      const reconId = created.data.reconciliation.id

      const res = await api.patch(
        `/admin/payment_reports/reconciliation/${reconId}`,
        { actual_amount: 4500 },
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.reconciliation.status).toBe("Discrepant")
      expect(Number(res.data.reconciliation.discrepancy)).toBe(-500)
    })

    it("should settle a reconciliation record", async () => {
      const created = await api.post(
        "/admin/payment_reports/reconciliation",
        {
          reference_type: "manual",
          expected_amount: 5000,
          actual_amount: 4800,
        },
        adminHeaders
      )
      const reconId = created.data.reconciliation.id

      const res = await api.post(
        `/admin/payment_reports/reconciliation/${reconId}/settle`,
        { notes: "Difference waived by finance" },
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.reconciliation.status).toBe("Settled")
      expect(res.data.reconciliation.settled_at).toBeDefined()
      expect(res.data.reconciliation.settled_by).toBeDefined()
    })

    it("should not settle an already settled reconciliation", async () => {
      const created = await api.post(
        "/admin/payment_reports/reconciliation",
        {
          reference_type: "manual",
          expected_amount: 1000,
          actual_amount: 1000,
        },
        adminHeaders
      )
      const reconId = created.data.reconciliation.id

      // First settle
      await api.post(
        `/admin/payment_reports/reconciliation/${reconId}/settle`,
        {},
        adminHeaders
      )

      // Second settle — should fail
      const res = await api
        .post(
          `/admin/payment_reports/reconciliation/${reconId}/settle`,
          {},
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.data.message || res.data.error || "").toMatch(
        /already settled/i
      )
    })

    it("should filter reconciliations by status", async () => {
      // Create matched and discrepant records
      await api.post(
        "/admin/payment_reports/reconciliation",
        { reference_type: "manual", expected_amount: 100, actual_amount: 100 },
        adminHeaders
      )
      await api.post(
        "/admin/payment_reports/reconciliation",
        { reference_type: "manual", expected_amount: 200, actual_amount: 150 },
        adminHeaders
      )

      const res = await api.get("/admin/payment_reports/reconciliation", {
        ...adminHeaders,
        params: { status: "Matched" },
      })

      expect(res.status).toBe(200)
      res.data.reconciliations.forEach((r: any) => {
        expect(r.status).toBe("Matched")
      })
    })
  })

  // ─── Report Integration ───────────────────────────────────────────────────

  describe("GET /admin/payment_reports/summary with reconciliation", () => {
    it("should include reconciliation_summary when include_reconciliation=true", async () => {
      // Create a reconciliation record first
      await api.post(
        "/admin/payment_reports/reconciliation",
        {
          reference_type: "manual",
          expected_amount: 5000,
          actual_amount: 4500,
        },
        adminHeaders
      )

      const res = await api.get("/admin/payment_reports/summary", {
        ...adminHeaders,
        params: { include_reconciliation: "true" },
      })

      expect(res.status).toBe(200)
      expect(res.data.reconciliation_summary).toBeDefined()
      expect(
        typeof res.data.reconciliation_summary.total_expected
      ).toBe("number")
      expect(typeof res.data.reconciliation_summary.total_actual).toBe(
        "number"
      )
      expect(
        typeof res.data.reconciliation_summary.total_discrepancy
      ).toBe("number")
      expect(
        typeof res.data.reconciliation_summary.record_count
      ).toBe("number")
      expect(res.data.reconciliation_summary.by_status).toBeDefined()
    })

    it("should return null reconciliation_summary when flag is not set", async () => {
      const res = await api.get(
        "/admin/payment_reports/summary",
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.reconciliation_summary).toBeNull()
    })
  })

  // ─── Auth Guards ──────────────────────────────────────────────────────────

  describe("Auth protection", () => {
    it("should reject unauthenticated partner endpoints", async () => {
      const endpoints = [
        () => api.get("/partners/payment-submissions"),
        () =>
          api.post("/partners/payment-submissions", {
            design_ids: ["fake"],
          }),
      ]

      for (const call of endpoints) {
        const res = await call().catch((e: any) => e.response)
        expect([401, 403]).toContain(res.status)
      }
    })

    it("should reject unauthenticated admin endpoints", async () => {
      const endpoints = [
        () => api.get("/admin/payment-submissions"),
        () => api.get("/admin/payment_reports/reconciliation"),
      ]

      for (const call of endpoints) {
        const res = await call().catch((e: any) => e.response)
        expect([401, 403]).toContain(res.status)
      }
    })
  })
})
