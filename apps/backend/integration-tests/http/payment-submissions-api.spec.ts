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

  /**
   * A COMPLETED production run for this partner, written straight through the
   * module service.
   *
   * The fixture only needs the end state, and driving a real dispatch →
   * accept → complete cycle would drag partner auth and the whole run lifecycle
   * into a test about payment. Mirrors the shape completion leaves behind,
   * including the parent/child convention: the partner and the money live on
   * the CHILD run, and a parent carries `partner_id: null`.
   */
  async function createCompletedRun(
    designId: string,
    designName: string,
    overrides: Record<string, any> = {}
  ) {
    const container = getContainer()
    const runService: any = container.resolve("production_runs")
    const run = await runService.createProductionRuns({
      design_id: designId,
      partner_id: partnerId,
      quantity: 9,
      produced_quantity: 4,
      partner_cost_estimate: 1200,
      cost_type: "per_unit",
      run_type: "production",
      status: "completed",
      completed_at: new Date(),
      snapshot: { design: { id: designId, name: designName } },
      captured_at: new Date(),
      ...overrides,
    })
    return (Array.isArray(run) ? run[0] : run).id as string
  }

  // ─── Payable runs (#1556) ─────────────────────────────────────────────────

  describe("A stored cost of 0 is not a cost (#1563)", () => {
    it("refuses a design whose stored cost is 0 rather than billing nothing", async () => {
      // 🔴 `recalculate-cost` writes `total_estimated: 0` with
      // `confidence: "estimated"` when the estimator finds no BOM and no
      // inventory history — it reports "I found nothing" as "this costs
      // nothing". Four prod designs were flipped from null to 0 that way.
      //
      // The old guard asked `=== null || === undefined`, so 0 passed it and the
      // workflow produced a payment line billing 0 that looked like a real
      // claim. "No cost recorded" must refuse, exactly as it did before anyone
      // pressed recalculate.
      const d1 = await createDesign("Zero Cost Design", { estimated_cost: 0 })
      await linkDesignToPartner(d1, partnerId)

      const res = await api
        .post(
          "/admin/payment-submissions",
          { partner_id: partnerId, design_ids: [d1] },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(res.data.message).toContain("Designs missing cost")
    })

    it("still bills a 0-cost design when a real rate is supplied", async () => {
      // The refusal is about the absence of a figure, not a ban on the design.
      // An admin who knows the agreed rate types it and the payout goes through
      // — which is the whole point of the run-sourced screen.
      const d1 = await createDesign("Zero Cost But Priced", {
        estimated_cost: 0,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 3 },
          unit_amounts: { [d1]: 250 },
        },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(750)
    })
  })

  describe("GET /admin/payment-submissions/payable-runs", () => {
    it("requires partner_id rather than listing every completed run", async () => {
      // An unfiltered variant would return every partner's runs. That exact
      // shape — a missing filter reading as "no filter" rather than "no rows" —
      // is how one dangling key produced unfiltered cross-tenant results.
      const res = await api
        .get("/admin/payment-submissions/payable-runs", adminHeaders)
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })

    it("prices a run from the run, and bills the PRODUCED quantity", async () => {
      // The design says 5000/unit; the run says 1200/unit and 4 pieces made.
      // Pricing off the design here would bill 5000 x 9 = 45,000 for work worth
      // 4,800 — the two figures are not close, and the run is the agreed one.
      const d1 = await createDesign("Payable Run Design", {
        estimated_cost: 5000,
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Payable Run Design")

      const res = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )

      expect(res.status).toBe(200)
      const row = res.data.payable_runs.find((r: any) => r.run_id === runId)
      expect(row).toBeDefined()
      expect(row.ordered_quantity).toBe(9)
      expect(row.produced_quantity).toBe(4)
      // 🔑 The founder rule: pay for what was MADE, not what was ordered.
      expect(row.payable_quantity).toBe(4)
      expect(row.quantity_basis).toBe("produced")
      expect(row.unit_amount).toBe(1200)
      expect(row.amount).toBe(4800)
      expect(row.payable).toBe(true)
      expect(row.billed).toBeNull()
    })

    it("divides a 'total' cost_type back out to a per-unit rate", async () => {
      // `partner_cost_estimate` is stored verbatim and paired with `cost_type`;
      // a "total" of 3600 across 3 ordered pieces is 1200/unit. Reading it as
      // per-unit would bill 3600 x 3.
      const d1 = await createDesign("Total Cost Run", { estimated_cost: 100 })
      await linkDesignToPartner(d1, partnerId)
      await createCompletedRun(d1, "Total Cost Run", {
        quantity: 3,
        produced_quantity: 3,
        partner_cost_estimate: 3600,
        cost_type: "total",
      })

      const res = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )
      const row = res.data.payable_runs[0]
      expect(row.unit_amount).toBe(1200)
      expect(row.amount).toBe(3600)
    })

    it("falls back to the ordered quantity and SAYS SO when output was never recorded", async () => {
      // "We never recorded output" and "they made zero" must not look alike.
      const d1 = await createDesign("No Output Run", { estimated_cost: 100 })
      await linkDesignToPartner(d1, partnerId)
      await createCompletedRun(d1, "No Output Run", {
        quantity: 5,
        produced_quantity: null,
      })

      const res = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )
      const row = res.data.payable_runs[0]
      expect(row.produced_quantity).toBeNull()
      expect(row.payable_quantity).toBe(5)
      expect(row.quantity_basis).toBe("ordered")
    })

    it("marks a run with no agreed rate unpayable instead of billing zero", async () => {
      // A run with no cost is not a zero-value payout — it is a run whose price
      // has not been settled. Surfaced, not silently dropped.
      const d1 = await createDesign("Unpriced Run", { estimated_cost: 100 })
      await linkDesignToPartner(d1, partnerId)
      await createCompletedRun(d1, "Unpriced Run", {
        partner_cost_estimate: null,
      })

      const res = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )
      const row = res.data.payable_runs[0]
      expect(row.payable).toBe(false)
      expect(row.unit_amount).toBe(0)
    })

    it("never returns another partner's runs, nor an unfinished one", async () => {
      const other = await createPartnerWithAuth(
        Math.floor(Math.random() * 100000)
      )
      const d1 = await createDesign("Other Partner Run", {
        estimated_cost: 100,
      })
      await linkDesignToPartner(d1, other.partnerId)
      const otherRunId = await createCompletedRun(d1, "Other Partner Run", {
        partner_id: other.partnerId,
      })

      const d2 = await createDesign("In Progress Run", { estimated_cost: 100 })
      await linkDesignToPartner(d2, partnerId)
      const inProgressId = await createCompletedRun(d2, "In Progress Run", {
        status: "in_progress",
      })

      const res = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )

      const ids = res.data.payable_runs.map((r: any) => r.run_id)
      expect(ids).not.toContain(otherRunId)
      expect(ids).not.toContain(inProgressId)
    })
  })

  /**
   * "We can't tell" must not be spelled the same way as "no" (#1565).
   *
   * Every payment line on production recorded no run at all, so the #1556 guard
   * returned `billed: null` for all 13 submissions — and the screen sorted those
   * runs to the top as clean, payable work. Absence read as permission.
   */
  describe("GET payable-runs — an unrecorded payout is UNKNOWN, not clear (#1565)", () => {
    it("reports a run as unknown when a live payout for its design names no run", async () => {
      const d1 = await createDesign("Unrecorded Claim Design", {
        estimated_cost: 1200,
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Unrecorded Claim Design")

      // A payout for the DESIGN with no `production_run_ids` — the shape every
      // pre-#1556 submission has, and the shape the auto-draft subscriber wrote
      // for months.
      const sub = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
        },
        adminHeaders
      )
      expect(sub.status).toBe(201)
      const submissionId = sub.data.payment_submission.id

      // The line says so about itself rather than leaving a NULL to be
      // interpreted — three different situations produce that NULL.
      const detail = await api.get(
        `/admin/payment-submissions/${submissionId}`,
        adminHeaders
      )
      expect(detail.data.payment_submission.items[0].run_provenance).toBe(
        "not_recorded"
      )

      const res = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )
      const row = res.data.payable_runs.find((r: any) => r.run_id === runId)

      // 🔴 The assertion that fails on the old code: `billed` is still null —
      // no line NAMES this run — but that null is ignorance, not innocence.
      // This payout may already have covered these very garments.
      expect(row.billed).toBeNull()
      expect(row.billing_status).toBe("unknown")
      expect(row.unrecorded_claims).toHaveLength(1)
      expect(row.unrecorded_claims[0].submission_id).toBe(submissionId)
    })

    it("leaves other runs of the design CLEAR when the payout did name its run", async () => {
      // The counter-case. A `recorded` line is not a source of doubt: it says
      // exactly what it covered, so the design's OTHER completed run is safe to
      // bill. Without this, "unknown" would swallow the whole screen and the
      // guard would be useless in the other direction.
      const d1 = await createDesign("Recorded Claim Design", {
        estimated_cost: 1200,
      })
      await linkDesignToPartner(d1, partnerId)
      const paidRun = await createCompletedRun(d1, "Recorded Claim Design")
      const freshRun = await createCompletedRun(d1, "Recorded Claim Design")

      await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
          production_run_ids: { [d1]: [paidRun] },
        },
        adminHeaders
      )

      const res = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )
      const paid = res.data.payable_runs.find((r: any) => r.run_id === paidRun)
      const fresh = res.data.payable_runs.find((r: any) => r.run_id === freshRun)

      expect(paid.billing_status).toBe("billed")
      expect(fresh.billing_status).toBe("clear")
      expect(fresh.unrecorded_claims).toHaveLength(0)
    })

    it("does not rank an unknown run above genuinely clear work", async () => {
      // Sorting an unverifiable run alongside unpaid work is precisely how a
      // second payout for the same garments gets made — the reviewer sees two
      // rows that look identical and pays both.
      // 🔴 The clean run is deliberately the OLDER of the two. The tie-break
      // below `billing_status` is newest-completion-first, so a doubtful run
      // completed later would sort above it on the old code — which is exactly
      // the arrangement this test has to rule out. Build the fixture the other
      // way round and it passes without the fix, proving nothing.
      const clean = await createDesign("Clean Design", { estimated_cost: 1200 })
      await linkDesignToPartner(clean, partnerId)
      const cleanRun = await createCompletedRun(clean, "Clean Design")

      const doubtful = await createDesign("Doubtful Design", {
        estimated_cost: 1200,
      })
      await linkDesignToPartner(doubtful, partnerId)
      const doubtfulRun = await createCompletedRun(doubtful, "Doubtful Design", {
        completed_at: new Date(Date.now() + 60_000),
      })
      await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [doubtful],
          quantities: { [doubtful]: 4 },
          unit_amounts: { [doubtful]: 1200 },
        },
        adminHeaders
      )

      const res = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )
      const order = res.data.payable_runs.map((r: any) => r.run_id)
      expect(order.indexOf(cleanRun)).toBeLessThan(order.indexOf(doubtfulRun))
    })

    it("a task payout casts no doubt — a task never had a run to record", async () => {
      // `no_run` is the one case where a missing run is an ANSWER. If this
      // read as "not recorded" too, every partner who was ever paid for a task
      // would have all of their production runs stuck at `unknown` forever.
      const d1 = await createDesign("Task Payout Design", {
        estimated_cost: 1200,
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Task Payout Design")

      // A REAL task payout for this partner, not an absent one — otherwise
      // this test asserts `clear` about a partner with no payouts at all and
      // would pass just as happily on code that got `no_run` wrong.
      const container = getContainer()
      const taskService = container.resolve("tasks") as any
      const task = await taskService.createTasks({
        title: "Paid Task Beside A Run",
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
      const taskSub = await api.post(
        "/partners/payment-submissions",
        {
          task_ids: [task.id],
          metadata: { task_cost_overrides: { [task.id]: 1500 } },
        },
        { headers: partnerHeaders }
      )
      expect(taskSub.status).toBe(201)
      // The partner create response carries no line items, so read the line
      // back from the admin detail route rather than asserting on undefined.
      const taskDetail = await api.get(
        `/admin/payment-submissions/${taskSub.data.payment_submission.id}`,
        adminHeaders
      )
      const taskItem = taskDetail.data.payment_submission.items[0]
      expect(taskItem.source_type).toBe("task")
      expect(taskItem.run_provenance).toBe("no_run")

      const res = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )
      const row = res.data.payable_runs.find((r: any) => r.run_id === runId)
      expect(row.billing_status).toBe("clear")
    })
  })

  /**
   * Correcting a payment line's provenance by hand (#1565).
   *
   * 🔴 `/admin/payment-submissions/:id` exposes GET and `review` and nothing
   * else — no route updates a submission or its items. For a line whose run is
   * named only in free-text notes (which the backfill job refuses to parse),
   * this job is the ONLY remedy short of rejecting a live payout and recreating
   * it.
   */
  describe("record-payment-line-run maintenance job (#1565)", () => {
    const RUN = "/admin/ops/maintenance-jobs/record-payment-line-run/run"

    /** A design-sourced line with no run recorded, plus a run it could name. */
    async function unrecordedLine(designName: string) {
      const designId = await createDesign(designName, { estimated_cost: 1200 })
      await linkDesignToPartner(designId, partnerId)
      const runId = await createCompletedRun(designId, designName)

      const sub = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [designId],
          quantities: { [designId]: 4 },
          unit_amounts: { [designId]: 1200 },
        },
        adminHeaders
      )
      expect(sub.status).toBe(201)
      const detail = await api.get(
        `/admin/payment-submissions/${sub.data.payment_submission.id}`,
        adminHeaders
      )
      return {
        designId,
        runId,
        itemId: detail.data.payment_submission.items[0].id,
        submissionId: sub.data.payment_submission.id,
      }
    }

    it("records the run an operator supplies, and the line then guards", async () => {
      const { runId, itemId } = await unrecordedLine("Notes Only Payout")

      const dry = await api.post(
        RUN,
        { dry_run: true, params: { payment_submission_item_id: itemId, production_run_id: runId } },
        adminHeaders
      )
      expect(dry.status).toBe(200)
      expect(dry.data.result.applied).toBe(false)
      expect(dry.data.result.changes[0].after).toEqual([runId])

      const applied = await api.post(
        RUN,
        { dry_run: false, params: { payment_submission_item_id: itemId, production_run_id: runId } },
        adminHeaders
      )
      expect(applied.status).toBe(200)
      expect(applied.data.result.applied).toBe(true)

      // The EFFECT, not the summary: the run now reads as billed rather than
      // unknown, which is the whole point of recording it.
      const runs = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )
      const row = runs.data.payable_runs.find((r: any) => r.run_id === runId)
      expect(row.billing_status).toBe("billed")
    })

    it("refuses a run already recorded on another live payout", async () => {
      // 🔴 Without this the job would be a hole straight through the double-pay
      // guard it exists to arm: two lines could both claim the same garments.
      const first = await unrecordedLine("Double Claim Design")
      await api.post(
        RUN,
        {
          dry_run: false,
          params: { payment_submission_item_id: first.itemId, production_run_id: first.runId },
        },
        adminHeaders
      )

      // Close the first payout so the design-level "already in an open
      // submission" guard is out of the way and ONLY the run-level guard is
      // under test. This is also the realistic case: the run-level guard exists
      // precisely because the design-level one goes false once a payout closes.
      const approved = await api.post(
        `/admin/payment-submissions/${first.submissionId}/review`,
        { action: "approve", paid_to_id: paidToId },
        adminHeaders
      )
      expect(approved.status).toBe(200)

      // A second payout for the same design, pointed at the same run.
      const second = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [first.designId],
          quantities: { [first.designId]: 4 },
          unit_amounts: { [first.designId]: 1200 },
        },
        adminHeaders
      )
      const secondDetail = await api.get(
        `/admin/payment-submissions/${second.data.payment_submission.id}`,
        adminHeaders
      )
      const secondItemId = secondDetail.data.payment_submission.items[0].id

      const res = await api
        .post(
          RUN,
          {
            dry_run: false,
            params: {
              payment_submission_item_id: secondItemId,
              production_run_id: first.runId,
            },
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(String(res.data?.message || "")).toMatch(/already recorded/i)
    })

    it("refuses a run belonging to a different design", async () => {
      // An operator-supplied id is a claim, not a fact. A run belongs to exactly
      // one design, so this one is describing different work entirely.
      const target = await unrecordedLine("Wrong Design Target")
      const otherDesign = await createDesign("Unrelated Design", {
        estimated_cost: 1200,
      })
      await linkDesignToPartner(otherDesign, partnerId)
      const otherRun = await createCompletedRun(otherDesign, "Unrelated Design")

      const res = await api
        .post(
          RUN,
          {
            dry_run: false,
            params: {
              payment_submission_item_id: target.itemId,
              production_run_id: otherRun,
            },
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(String(res.data?.message || "")).toMatch(/is a run of design/i)
    })

    it("refuses to overwrite a line that already records its run", async () => {
      // Provenance written by a real submission path is better evidence than
      // anything typed afterwards; correcting it is a different decision.
      const d1 = await createDesign("Already Recorded", { estimated_cost: 1200 })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Already Recorded")
      const sub = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
          production_run_ids: { [d1]: [runId] },
        },
        adminHeaders
      )
      const detail = await api.get(
        `/admin/payment-submissions/${sub.data.payment_submission.id}`,
        adminHeaders
      )
      const itemId = detail.data.payment_submission.items[0].id

      const res = await api
        .post(
          RUN,
          {
            dry_run: false,
            params: { payment_submission_item_id: itemId, production_run_id: runId },
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(String(res.data?.message || "")).toMatch(/already records/i)
    })
  })

  /**
   * The typed money fields are the contract; `metadata` is a fallback (#1571).
   *
   * 🔴 The workflow used to read the money ONLY off `metadata`, so the typed
   * fields were a validation façade over an untyped contract — post the blob
   * directly and every typed guarantee was bypassed.
   */
  describe("money travels typed, not through metadata (#1571)", () => {
    /**
     * ⚠️ REGRESSION LOCK, not proof of the fix. This already passed before
     * #1571, because the route's `foldMoneyFieldsIntoMetadata` overwrites the
     * blob with the typed values on the way in. The workflow-level precedence
     * added in #1571 is what makes it true for callers that reach the workflow
     * DIRECTLY — the auto-draft subscriber — where no fold runs.
     */
    it("the typed field WINS over a conflicting metadata blob", async () => {
      const d1 = await createDesign("Typed Wins Design", {
        estimated_cost: 1200,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
          // A stale blob claiming something different. The typed field is the
          // caller's stated intent; an untyped channel must not overrule it.
          metadata: {
            design_quantities: { [d1]: 99 },
            design_unit_amounts: { [d1]: 5 },
          },
        },
        adminHeaders
      )
      expect(res.status).toBe(201)

      const detail = await api.get(
        `/admin/payment-submissions/${res.data.payment_submission.id}`,
        adminHeaders
      )
      const item = detail.data.payment_submission.items[0]
      expect(Number(item.quantity)).toBe(4)
      expect(Number(item.unit_amount)).toBe(1200)
      expect(Number(item.amount)).toBe(4800)
    })

    /** Also a regression lock: the legacy path must not change at all. */
    it("still honours a caller that only posts metadata", async () => {
      // 🔴 The legacy channel is deliberately kept. Dropping it would silently
      // re-price such a caller's line off the design's stored cost — a money
      // change nobody asked for is worse than the channel being untyped.
      const d1 = await createDesign("Legacy Metadata Design", {
        estimated_cost: 1200,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          metadata: {
            design_quantities: { [d1]: 3 },
            design_unit_amounts: { [d1]: 700 },
          },
        },
        adminHeaders
      )
      expect(res.status).toBe(201)

      const detail = await api.get(
        `/admin/payment-submissions/${res.data.payment_submission.id}`,
        adminHeaders
      )
      const item = detail.data.payment_submission.items[0]
      expect(Number(item.quantity)).toBe(3)
      expect(Number(item.amount)).toBe(2100)
    })

    it("REFUSES a misspelt money key instead of ignoring it", async () => {
      // The #1554 defect, reachable by one letter: `design_quantites` validates
      // cleanly, is read by nothing, and the line falls through to "absent
      // means 1" — a per-unit rate billed once. There is no bad VALUE to
      // reject, only a fact that never arrived, so the boundary is the only
      // place it can be seen.
      const d1 = await createDesign("Typo Key Design", { estimated_cost: 1200 })
      await linkDesignToPartner(d1, partnerId)

      const res = await api
        .post(
          "/admin/payment-submissions",
          {
            partner_id: partnerId,
            design_ids: [d1],
            metadata: { design_quantites: { [d1]: 9 } },
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(String(res.data?.message || "")).toMatch(/design_quantities/)
    })

    it("refuses the same typo on the partner route", async () => {
      const d1 = await createDesign("Partner Typo Design", {
        estimated_cost: 1200,
      })
      await linkDesignToPartner(d1, partnerId)

      const res = await api
        .post(
          "/partners/payment-submissions",
          {
            design_ids: [d1],
            metadata: { design_cost_override: { [d1]: 900 } },
          },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(String(res.data?.message || "")).toMatch(/design_cost_overrides/)
    })
  })

  /**
   * Correcting a run must re-price the Draft it pre-filled (#1571).
   *
   * 🔴 `auto-draft-payment-submission` writes a Draft at completion using the
   * figures of that moment. Correcting the run afterwards changed nothing about
   * it — and no route could fix it either, since `review` refuses anything that
   * is not Pending or Under_Review. A reviewer would approve a figure that no
   * longer matches the run it came from. This happened on prod:
   * `prod_run_01KZWX801S8HBNZ8DYBVNJK5GZ` drafted at 1190 and corrected to 840.
   */
  describe("a run correction re-prices its unclaimed Draft", () => {
    /** A completed run plus the Draft payout the subscriber pre-filled from it. */
    async function runWithDraft(name: string) {
      const designId = await createDesign(name, { estimated_cost: 1200 })
      await linkDesignToPartner(designId, partnerId)
      const runId = await createCompletedRun(designId, name, {
        quantity: 1,
        produced_quantity: 3,
        partner_cost_estimate: 1190,
        cost_type: "per_unit",
      })

      const sub = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [designId],
          quantities: { [designId]: 1 },
          unit_amounts: { [designId]: 1190 },
          production_run_ids: { [designId]: [runId] },
          status: "Draft",
        },
        adminHeaders
      )
      expect(sub.status).toBe(201)
      return { designId, runId, submissionId: sub.data.payment_submission.id }
    }

    it("re-prices the Draft when the run's rate is corrected", async () => {
      const { runId, submissionId } = await runWithDraft("Stale Draft Design")

      const before = await api.get(
        `/admin/payment-submissions/${submissionId}`,
        adminHeaders
      )
      expect(Number(before.data.payment_submission.total_amount)).toBe(1190)

      // The correction that used to leave the Draft stale.
      const corrected = await api.post(
        `/admin/production-runs/${runId}`,
        { partner_cost_estimate: 840, cost_type: "total", produced_quantity: 1 },
        adminHeaders
      )
      expect(corrected.status).toBe(200)

      // The EFFECT, re-read rather than taken from the correction's response.
      const after = await api.get(
        `/admin/payment-submissions/${submissionId}`,
        adminHeaders
      )
      expect(Number(after.data.payment_submission.total_amount)).toBe(840)
      expect(Number(after.data.payment_submission.items[0].amount)).toBe(840)
    })

    /**
     * ⚠️ Passes on the old code too — it never touched anything. Kept as the
     * guard that stops this fix over-reaching: the refresh must never widen
     * from Draft to a live claim.
     */
    it("REFUSES to touch a payout somebody has already claimed", async () => {
      // 🔴 The guard that keeps this from being dangerous. A Pending submission
      // is a partner saying "pay me this"; silently rewriting it would change
      // what they are owed without them ever seeing it.
      const designId = await createDesign("Claimed Payout Design", {
        estimated_cost: 1200,
      })
      await linkDesignToPartner(designId, partnerId)
      const runId = await createCompletedRun(designId, "Claimed Payout Design", {
        quantity: 1,
        produced_quantity: 3,
        partner_cost_estimate: 1190,
        cost_type: "per_unit",
      })

      const sub = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [designId],
          quantities: { [designId]: 1 },
          unit_amounts: { [designId]: 1190 },
          production_run_ids: { [designId]: [runId] },
          // Pending, not Draft — a live claim.
        },
        adminHeaders
      )
      const submissionId = sub.data.payment_submission.id

      await api.post(
        `/admin/production-runs/${runId}`,
        { partner_cost_estimate: 840, cost_type: "total", produced_quantity: 1 },
        adminHeaders
      )

      const after = await api.get(
        `/admin/payment-submissions/${submissionId}`,
        adminHeaders
      )
      expect(Number(after.data.payment_submission.total_amount)).toBe(1190)
    })
  })

  describe("POST /admin/payment-submissions — run provenance (#1556)", () => {
    it("records which runs a line paid for, and reports them as billed", async () => {
      const d1 = await createDesign("Provenance Design", {
        estimated_cost: 5000,
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Provenance Design")

      const res = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
          production_run_ids: { [d1]: [runId] },
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      const submissionId = res.data.payment_submission.id

      const detail = await api.get(
        `/admin/payment-submissions/${submissionId}`,
        adminHeaders
      )
      const item = detail.data.payment_submission.items[0]
      // A real column, not a metadata key — this is what the double-pay guard
      // reads, and a guard reading an untyped blob reads nothing when the key
      // is misspelt.
      expect(item.production_run_ids).toEqual([runId])

      const runs = await api.get(
        `/admin/payment-submissions/payable-runs?partner_id=${partnerId}`,
        adminHeaders
      )
      const row = runs.data.payable_runs.find((r: any) => r.run_id === runId)
      expect(row.billed).not.toBeNull()
      expect(row.billed.submission_id).toBe(submissionId)
      expect(Number(row.billed.quantity)).toBe(4)
    })

    it("refuses to pay for the same run twice, even after the first payout closed", async () => {
      // 🔴 The case the design-level guard cannot catch. "Is this design in an
      // OPEN submission" stops being true the moment the first submission is
      // Approved or Paid — after which the same finished run can be claimed
      // again and the second claim looks exactly as legitimate as the first.
      const d1 = await createDesign("Double Pay Design", {
        estimated_cost: 5000,
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Double Pay Design")

      const first = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
          production_run_ids: { [d1]: [runId] },
        },
        adminHeaders
      )
      expect(first.status).toBe(201)

      // Close the first payout so the design-level guard is out of the way and
      // ONLY the run-level guard is under test.
      const approved = await api.post(
        `/admin/payment-submissions/${first.data.payment_submission.id}/review`,
        { action: "approve", paid_to_id: paidToId },
        adminHeaders
      )
      expect(approved.status).toBe(200)

      const second = await api
        .post(
          "/admin/payment-submissions",
          {
            partner_id: partnerId,
            design_ids: [d1],
            quantities: { [d1]: 4 },
            unit_amounts: { [d1]: 1200 },
            production_run_ids: { [d1]: [runId] },
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(second.status).toBe(400)
      expect(second.data.message).toContain("already paid for")
      expect(second.data.message).toContain(runId)
    })

    it("releases a run when its submission was rejected", async () => {
      // A Rejected submission never paid anyone. The exact situation the
      // Shramdaan correction hit: a payout billed the wrong quantity, was
      // rejected, and the replacement has to be allowed to bill the same run.
      const d1 = await createDesign("Rejected Release Design", {
        estimated_cost: 5000,
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Rejected Release Design")

      const first = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
          production_run_ids: { [d1]: [runId] },
        },
        adminHeaders
      )
      await api.post(
        `/admin/payment-submissions/${first.data.payment_submission.id}/review`,
        { action: "reject", rejection_reason: "Quantity corrected 4 -> 7" },
        adminHeaders
      )

      const replacement = await api.post(
        "/admin/payment-submissions",
        {
          partner_id: partnerId,
          design_ids: [d1],
          quantities: { [d1]: 7 },
          unit_amounts: { [d1]: 1200 },
          production_run_ids: { [d1]: [runId] },
        },
        adminHeaders
      )

      expect(replacement.status).toBe(201)
      expect(Number(replacement.data.payment_submission.total_amount)).toBe(8400)
    })

    it("refuses a run that belongs to another partner", async () => {
      const other = await createPartnerWithAuth(
        Math.floor(Math.random() * 100000)
      )
      const d1 = await createDesign("Cross Partner Design", {
        estimated_cost: 5000,
      })
      // Linked to BOTH so the ownership check under test is the RUN's, not the
      // design's — otherwise this passes for the wrong reason.
      await linkDesignToPartner(d1, partnerId)
      await linkDesignToPartner(d1, other.partnerId)
      const foreignRun = await createCompletedRun(d1, "Cross Partner Design", {
        partner_id: other.partnerId,
      })

      const res = await api
        .post(
          "/admin/payment-submissions",
          {
            partner_id: partnerId,
            design_ids: [d1],
            quantities: { [d1]: 4 },
            unit_amounts: { [d1]: 1200 },
            production_run_ids: { [d1]: [foreignRun] },
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      // 400, not 403 — MedusaError.Types.NOT_ALLOWED maps to a 400 here, the
      // same as the existing "Designs not assigned to this partner" check.
      // The MESSAGE is what distinguishes the two refusals.
      expect(res.status).toBe(400)
      expect(res.data.message).toContain("does not belong to this partner")
    })

    it("refuses a run that is not completed", async () => {
      const d1 = await createDesign("Unfinished Design", {
        estimated_cost: 5000,
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Unfinished Design", {
        status: "in_progress",
      })

      const res = await api
        .post(
          "/admin/payment-submissions",
          {
            partner_id: partnerId,
            design_ids: [d1],
            quantities: { [d1]: 4 },
            unit_amounts: { [d1]: 1200 },
            production_run_ids: { [d1]: [runId] },
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(res.data.message).toContain("not completed")
    })

    it("refuses a run that belongs to a different design", async () => {
      const d1 = await createDesign("Claim Design", { estimated_cost: 5000 })
      const d2 = await createDesign("Actual Design", { estimated_cost: 5000 })
      await linkDesignToPartner(d1, partnerId)
      await linkDesignToPartner(d2, partnerId)
      const runOfD2 = await createCompletedRun(d2, "Actual Design")

      const res = await api
        .post(
          "/admin/payment-submissions",
          {
            partner_id: partnerId,
            design_ids: [d1],
            quantities: { [d1]: 4 },
            unit_amounts: { [d1]: 1200 },
            production_run_ids: { [d1]: [runOfD2] },
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(res.data.message).toContain("is not a run of design")
    })
  })

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

  // ─── Partner payable runs (#1571 B half) ──────────────────────────────────

  /**
   * The partner submission screen used to list DESIGNS, so every
   * partner-created payout recorded no run and the double-pay guard was
   * structurally blind to it. These exercise the partner-side mirror of
   * `/admin/payment-submissions/payable-runs` that the rewritten screen reads.
   *
   * 🔑 The first test is the one that matters most, and not for its assertions:
   * it is the only thing in this suite that calls the partner route AT ALL. The
   * route shipped with no entry in `middlewares.ts`, and since the `/partners*`
   * wildcard supplies only CORS and locale, `authenticate("partner", …)` never
   * ran — `req.auth_context` was undefined and every request 401'd. The route
   * file looked entirely correct. Nothing else in the suite touched it, so a
   * fully green run said nothing about it.
   */
  describe("GET /partners/payment-submissions/payable-runs", () => {
    it("returns this partner's completed runs, priced from the run and billing PRODUCED", async () => {
      const d1 = await createDesign("Partner Payable Run Design", {
        estimated_cost: 5000,
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Partner Payable Run Design")

      const res = await api.get(
        "/partners/payment-submissions/payable-runs",
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(200)
      const row = res.data.payable_runs.find((r: any) => r.run_id === runId)
      expect(row).toBeDefined()
      // The design says 5000/unit; the run says 1200/unit for 4 pieces made.
      // Pricing off the design would bill 45,000 for work worth 4,800 (#1554).
      expect(row.unit_amount).toBe(1200)
      expect(row.ordered_quantity).toBe(9)
      expect(row.produced_quantity).toBe(4)
      expect(row.payable_quantity).toBe(4)
      expect(row.quantity_basis).toBe("produced")
      expect(row.amount).toBe(4800)
      expect(row.billing_status).toBe("clear")
    })

    it("never shows one partner the runs of another", async () => {
      const other = await createPartnerWithAuth(
        Math.floor(Math.random() * 100000)
      )
      const d1 = await createDesign("Cross Tenant Run Design")
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Cross Tenant Run Design")

      // The OTHER partner asks. The run belongs to `partnerId`.
      const res = await api.get(
        "/partners/payment-submissions/payable-runs",
        { headers: other.partnerHeaders }
      )

      expect(res.status).toBe(200)
      expect(
        res.data.payable_runs.find((r: any) => r.run_id === runId)
      ).toBeUndefined()
    })

    it("reports a run already recorded on a live payout as billed, not clear", async () => {
      const d1 = await createDesign("Partner Billed Run Design")
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Partner Billed Run Design")

      await api.post(
        "/partners/payment-submissions",
        {
          design_ids: [d1],
          production_run_ids: { [d1]: [runId] },
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
        },
        { headers: partnerHeaders }
      )

      const res = await api.get(
        "/partners/payment-submissions/payable-runs",
        { headers: partnerHeaders }
      )

      const row = res.data.payable_runs.find((r: any) => r.run_id === runId)
      expect(row).toBeDefined()
      expect(row.billing_status).toBe("billed")
      expect(row.billed).not.toBeNull()
    })
  })

  /**
   * The screen's whole purpose: a partner billing for nine garments must not
   * be able to state one number and have it read as the line total.
   *
   * ⚠️ Both of these PASS on the pre-#1571-B tree. The partner POST route has
   * accepted `production_run_ids` / `quantities` / `unit_amounts` since the A
   * half shipped — what changed here is that the SCREEN now sends them. These
   * are regression LOCKS on the contract the screen depends on, not coverage
   * of the change. The coverage lives in the `payable-runs` block above, which
   * 401'd on the old tree.
   */
  describe("a partner submission states its runs (#1571 B half)", () => {
    it("records run provenance, so the double-pay guard can see it", async () => {
      const d1 = await createDesign("Partner Provenance Design")
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Partner Provenance Design")

      const res = await api.post(
        "/partners/payment-submissions",
        {
          design_ids: [d1],
          production_run_ids: { [d1]: [runId] },
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
        },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      // 4 x 1200 — the quantity is applied. Before this change the screen sent
      // a single `cost_override`, so a claim for four pieces billed one.
      expect(Number(res.data.payment_submission.total_amount)).toBe(4800)

      const detail = await api.get(
        `/partners/payment-submissions/${res.data.payment_submission.id}`,
        { headers: partnerHeaders }
      )
      const line = detail.data.payment_submission.items.find(
        (i: any) => i.design_id === d1
      )
      expect(line.run_provenance).toBe("recorded")
      expect(line.production_run_ids).toEqual([runId])
    })

    it("accepts a design in Technical_Review when a verified run backs the claim", async () => {
      // 🔴 `complete-production-run` sets the design to Technical_Review, which
      // is NOT one of the statuses the hand-submission gate accepts. So the
      // design a partner has just finished producing is never Approved at the
      // moment they bill for it, and the gate rejected precisely the claims it
      // should wave through — the runs screen could not submit anything.
      //
      // The completed run is the proof of finished work, and it is verified
      // (exists, completed, this partner, this design) before it counts.
      const d1 = await createDesign("Technical Review Design", {
        status: "Technical_Review",
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Technical Review Design")

      const res = await api.post(
        "/partners/payment-submissions",
        {
          design_ids: [d1],
          production_run_ids: { [d1]: [runId] },
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
        },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(4800)
    })

    it("still refuses an ineligible design when NO run backs the claim", async () => {
      // ⚠️ A regression LOCK — this passes on the pre-fix tree too. The waiver
      // is per-design and only where a run replaces the check, so a hand-picked
      // design line with no run stays gated exactly as before. Without this,
      // the exemption above could quietly widen into a blanket waiver.
      const d1 = await createDesign("Technical Review No Run", {
        status: "Technical_Review",
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
      expect(String(res.data?.message || "")).toContain("not eligible")
    })

    it("accepts a Superseded design when a verified run backs the claim", async () => {
      // A design revised AFTER the partner finished producing it goes
      // Superseded, and the partner is still owed for the work. 8 such rows
      // exist on prod; without this they are unpayable through the runs screen.
      const d1 = await createDesign("Superseded Produced Design", {
        status: "Superseded",
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Superseded Produced Design")

      const res = await api.post(
        "/partners/payment-submissions",
        {
          design_ids: [d1],
          production_run_ids: { [d1]: [runId] },
          quantities: { [d1]: 3 },
          unit_amounts: { [d1]: 500 },
        },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(Number(res.data.payment_submission.total_amount)).toBe(1500)
    })

    it("still refuses a Conceptual design even with a run behind it", async () => {
      // 🔴 A design that never left the concept stage cannot legitimately have
      // a completed run — that pairing is data drift, and paying it out
      // silently is how drift survives. The run-backed waiver is an ALLOWLIST;
      // Conceptual is outside it, so this 400s and an admin can still waive it
      // deliberately with `require_design_status: false`.
      const d1 = await createDesign("Conceptual With Run", {
        status: "Conceptual",
      })
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Conceptual With Run")

      const res = await api
        .post(
          "/partners/payment-submissions",
          {
            design_ids: [d1],
            production_run_ids: { [d1]: [runId] },
            quantities: { [d1]: 3 },
            unit_amounts: { [d1]: 500 },
          },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(String(res.data?.message || "")).toContain("not eligible")
    })

    it("refuses to claim a run a live payout already covers", async () => {
      const d1 = await createDesign("Partner Double Claim Design")
      await linkDesignToPartner(d1, partnerId)
      const runId = await createCompletedRun(d1, "Partner Double Claim Design")

      const first = await api.post(
        "/partners/payment-submissions",
        {
          design_ids: [d1],
          production_run_ids: { [d1]: [runId] },
          quantities: { [d1]: 4 },
          unit_amounts: { [d1]: 1200 },
        },
        { headers: partnerHeaders }
      )
      expect(first.status).toBe(201)

      const second = await api
        .post(
          "/partners/payment-submissions",
          {
            design_ids: [d1],
            production_run_ids: { [d1]: [runId] },
            quantities: { [d1]: 4 },
            unit_amounts: { [d1]: 1200 },
          },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(second.status).toBe(400)
    })
  })

  // ─── Auth Guards ──────────────────────────────────────────────────────────

  describe("Auth protection", () => {
    it("should reject unauthenticated partner endpoints", async () => {
      const endpoints = [
        () => api.get("/partners/payment-submissions"),
        () => api.get("/partners/payment-submissions/payable-runs"),
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
