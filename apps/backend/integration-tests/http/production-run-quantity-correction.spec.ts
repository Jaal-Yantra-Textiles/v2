import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(180000)

/**
 * Correcting a run's agreed quantity after the work is done (#1695).
 *
 * The real case: run `prod_run_01M0YVV2M7H7BZWJF5WN4MW4ZR` was sent for 2 and
 * the partner made 3, with a ₹1,400 DRAFT submission standing against it —
 * unpaid, unclaimed, uncontested. The correction was impossible from either
 * end. The run refused because work had begun; `PATCH .../items/:itemId`
 * refused a claim of 3 against a ceiling of 2. It took an ops job to break the
 * deadlock, which is the right escape hatch and the wrong daily mechanism.
 *
 * 🔑 The freeze point is SETTLEMENT, not the start of work. These exercise the
 * ROUTE — the unit tests pin the rule, this pins that the route actually asks
 * it, refuses on it, and cascades the money afterwards.
 */
setupSharedTestSuite(() => {
  describe("Admin: correcting a production run's quantity", () => {
    const { api, getContainer } = getSharedTestEnv()

    async function setupTestData() {
      const container = getContainer()
      const unique = Date.now()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      return { adminHeaders, unique }
    }

    async function createPartner(unique: number) {
      const email = `qty-correction-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      let loginRes = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${loginRes.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Qty Correction Partner ${unique}`,
          handle: `qty-correction-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)

      loginRes = await api.post("/auth/partner/emailpass", { email, password })
      headers = { Authorization: `Bearer ${loginRes.data.token}` }

      return { partnerId: res.data.partner.id, partnerHeaders: headers }
    }

    async function createTemplate(adminHeaders: any, unique: number) {
      const name = `qty-correction-cutting-${unique}`
      const res = await api.post(
        "/admin/task-templates",
        {
          name,
          description: "Cutting",
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: `Qty Correction ${unique}`,
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return name
    }

    async function createDesign(adminHeaders: any, unique: number) {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Qty Correction Design ${unique}`,
          description: "Design for quantity correction test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    /**
     * A run sent for `quantity`, completed by the partner at `produced` on a
     * per-unit rate — which is the shape that auto-drafts a payout.
     */
    async function completedRun(opts: {
      adminHeaders: any
      partnerId: string
      partnerHeaders: any
      templateName: string
      designId: string
      quantity: number
      produced: number
      rate: number
    }) {
      const createRes = await api.post(
        `/admin/designs/${opts.designId}/production-runs`,
        {
          quantity: opts.quantity,
          assignments: [
            {
              partner_id: opts.partnerId,
              quantity: opts.quantity,
              template_names: [opts.templateName],
            },
          ],
        },
        opts.adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      const h = { headers: opts.partnerHeaders }
      await api.post(`/partners/production-runs/${runId}/accept`, {}, h)
      await api.post(`/partners/production-runs/${runId}/start`, {}, h)
      await api.post(`/partners/production-runs/${runId}/finish`, {}, h)
      const completeRes = await api.post(
        `/partners/production-runs/${runId}/complete`,
        {
          produced_quantity: opts.produced,
          partner_cost_estimate: opts.rate,
          cost_type: "per_unit",
        },
        h
      )
      expect(completeRes.status).toBe(200)

      return runId
    }

    async function draftForRun(adminHeaders: any, partnerId: string, runId: string) {
      const res = await api.get(
        `/admin/payment-submissions?partner_id=${partnerId}&limit=100`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      const submissions: any[] = res.data.payment_submissions ?? res.data.submissions ?? []
      for (const s of submissions) {
        const detail = await api.get(`/admin/payment-submissions/${s.id}`, adminHeaders)
        const items: any[] = detail.data.payment_submission?.items ?? []
        if (items.some((i) => (i.production_run_ids ?? []).includes(runId))) {
          return { submission: detail.data.payment_submission, items }
        }
      }
      return { submission: null, items: [] as any[] }
    }

    /**
     * ⚠️ The draft is written by the `production_run.completed` SUBSCRIBER, so
     * it does not exist the instant `complete` returns. Polling rather than
     * sleeping a fixed amount — a fixed sleep either flakes or wastes time, and
     * a lookup that raced would leave every claim assertion below vacuous.
     */
    async function waitForDraft(adminHeaders: any, partnerId: string, runId: string) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const found = await draftForRun(adminHeaders, partnerId, runId)
        if (found.submission) return found
        await new Promise((r) => setTimeout(r, 500))
      }
      return { submission: null, items: [] as any[] }
    }

    it("🔴 corrects a COMPLETED run whose only claim is a Draft — the deadlock case", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const templateName = await createTemplate(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      // Sent for 2, the partner made 3, at ₹700 a piece.
      const runId = await completedRun({
        adminHeaders,
        partnerId,
        partnerHeaders,
        templateName,
        designId,
        quantity: 2,
        produced: 3,
        rate: 700,
      })

      const res = await api.post(
        `/admin/production-runs/${runId}`,
        { quantity: 3 },
        adminHeaders
      )

      // Before #1695 this was a 4xx: "Cannot edit quantity, role, or run_type
      // after the run has been accepted or started".
      expect(res.status).toBe(200)
      expect(res.data.production_run.quantity).toBe(3)

      // The consequence, stated rather than left to be discovered on a payout.
      expect(res.data.ceiling).toBeTruthy()
      expect(res.data.ceiling.before).toBe(2)
      expect(res.data.ceiling.after).toBe(3)
      expect(res.data.ceiling.newly_claimable).toBe(1)
      expect(res.data.ceiling.worth).toBe(700)
    })

    it("cascades to the Draft payout instead of leaving it at the old number", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const templateName = await createTemplate(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const runId = await completedRun({
        adminHeaders,
        partnerId,
        partnerHeaders,
        templateName,
        designId,
        quantity: 2,
        produced: 3,
        rate: 700,
      })

      const before = await waitForDraft(adminHeaders, partnerId, runId)
      expect(before.submission).toBeTruthy()
      expect(before.submission.status).toBe("Draft")

      const res = await api.post(
        `/admin/production-runs/${runId}`,
        { quantity: 3 },
        adminHeaders
      )
      expect(res.status).toBe(200)

      /**
       * 🔴 The point of the cascade. `runPayableAmount` bills the ORDERED
       * quantity, so a draft written at completion against a quantity of 2 is
       * stale the moment the run says 3. A correction that does not cascade
       * just moves the disagreement somewhere new.
       */
      const after = await draftForRun(adminHeaders, partnerId, runId)
      expect(after.submission).toBeTruthy()
      expect(Number(after.submission.total_amount)).toBe(2100)
      expect(Number(after.submission.total_amount)).toBeGreaterThan(
        Number(before.submission.total_amount)
      )
    })

    it("refuses once the claim is no longer a Draft — that is a reversing entry, not an edit", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const templateName = await createTemplate(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const runId = await completedRun({
        adminHeaders,
        partnerId,
        partnerHeaders,
        templateName,
        designId,
        quantity: 2,
        produced: 3,
        rate: 700,
      })

      const { submission } = await waitForDraft(adminHeaders, partnerId, runId)
      expect(submission).toBeTruthy()

      const submitRes = await api.post(
        `/admin/payment-submissions/${submission.id}/submit`,
        {},
        adminHeaders
      )
      expect(submitRes.status).toBe(200)

      const res = await api
        .post(`/admin/production-runs/${runId}`, { quantity: 4 }, adminHeaders)
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(String(res.data?.message ?? "")).toMatch(/no longer a draft|reversing entry/i)

      // And the run is unchanged — a refusal must not half-apply.
      const check = await api.get(`/admin/production-runs/${runId}`, adminHeaders)
      expect(check.data.production_run.quantity).toBe(2)
    })

    it("refuses a lowering under what a Draft has already claimed", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const templateName = await createTemplate(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const runId = await completedRun({
        adminHeaders,
        partnerId,
        partnerHeaders,
        templateName,
        designId,
        quantity: 9,
        produced: 9,
        rate: 700,
      })

      // The claim has to EXIST for the refusal to mean anything — without it
      // there is nothing to overclaim and this passes vacuously.
      const { submission } = await waitForDraft(adminHeaders, partnerId, runId)
      expect(submission).toBeTruthy()

      const res = await api
        .post(`/admin/production-runs/${runId}`, { quantity: 1 }, adminHeaders)
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(String(res.data?.message ?? "")).toMatch(/retroactive overclaim/i)
    })

    it("still refuses role and run_type after the partner has accepted", async () => {
      // The relaxation is deliberately narrow. `role` and `run_type` say WHO is
      // doing the work and HOW; changing them under an accepted partner
      // rewrites the assignment, which no money rule makes safe.
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const templateName = await createTemplate(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const runId = await completedRun({
        adminHeaders,
        partnerId,
        partnerHeaders,
        templateName,
        designId,
        quantity: 2,
        produced: 2,
        rate: 700,
      })

      const res = await api
        .post(`/admin/production-runs/${runId}`, { role: "finishing" }, adminHeaders)
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(String(res.data?.message ?? "")).toMatch(/role or run_type/i)
    })
  })
})
