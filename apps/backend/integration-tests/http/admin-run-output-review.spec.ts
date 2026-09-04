import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240000)

/**
 * Reviewing what completed runs produced, in bulk (#1805).
 *
 * ## The assertion that matters is a COUNT, not a 200
 *
 * `create-product-from-design` appends another `"Custom - <name>"` variant when
 * the design already has a product. One approval at a time that is a rare
 * misclick; over a selection of runs it is the default, because a design
 * routinely has several completed runs and "select all completed" selects all
 * of them. A bulk tool that returns 200 twice while quietly listing the same
 * design twice is exactly the failure this exists to prevent — so the tests
 * below count products and variants after the fact, as the issue asked.
 */
setupSharedTestSuite(() => {
  describe("POST /admin/production-runs/approvals", () => {
    const { api, getContainer } = getSharedTestEnv()

    const loud = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (e: any) {
        console.log(`[${label}] ${e.response?.status}`, JSON.stringify(e.response?.data))
        throw e
      }
    }

    async function setup() {
      const container = getContainer()
      const unique = Date.now()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      return { adminHeaders, unique }
    }

    async function createPartner(unique: number, tag: string) {
      const email = `review-${tag}-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      let login = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${login.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Review Partner ${tag} ${unique}`,
          handle: `review-partner-${tag}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      login = await api.post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id,
        partnerHeaders: { Authorization: `Bearer ${login.data.token}` },
      }
    }

    async function createTemplate(adminHeaders: any, unique: number) {
      const name = `review-cutting-${unique}`
      await api.post(
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
          category: `Review Test ${unique}`,
        },
        adminHeaders
      )
      return name
    }

    /** A design costed in INR — the currency the product must be listed in. */
    async function createDesign(adminHeaders: any, unique: number, tag = "a") {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Review Design ${tag} ${unique}`,
          description: "Design for output review",
          design_type: "Original",
          status: "In_Development",
          priority: "Medium",
          estimated_cost: 850,
          cost_currency: "inr",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    async function completeRun(runId: string, partnerHeaders: any, produced = 10) {
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      const res = await api.post(
        `/partners/production-runs/${runId}/complete`,
        { produced_quantity: produced },
        { headers: partnerHeaders }
      )
      expect(res.data.production_run.status).toBe("completed")
    }

    /**
     * TWO completed runs of ONE design — the shape that breaks a naive bulk
     * loop. Partner assignments fan a design's run out into children, and both
     * children are "completed runs" in the operator's list.
     */
    async function twoCompletedRunsOfOneDesign(adminHeaders: any, unique: number) {
      const template = await createTemplate(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)
      const a = await createPartner(unique, "a")
      const b = await createPartner(unique, "b")

      const createRes = await loud("create-runs", () =>
        api.post(
          `/admin/designs/${designId}/production-runs`,
          {
            quantity: 20,
            assignments: [
              { partner_id: a.partnerId, quantity: 10, template_names: [template] },
              { partner_id: b.partnerId, quantity: 10, template_names: [template] },
            ],
          },
          adminHeaders
        )
      )
      const children = createRes.data.children
      expect(children).toHaveLength(2)

      await completeRun(children[0].id, a.partnerHeaders)
      await completeRun(children[1].id, b.partnerHeaders)

      return { designId, runIds: [children[0].id, children[1].id] as string[] }
    }

    const readRun = async (adminHeaders: any, runId: string) =>
      (await api.get(`/admin/production-runs/${runId}`, adminHeaders)).data
        .production_run

    /** 🔑 The count, straight off the product. */
    const readProduct = async (adminHeaders: any, productId: string) =>
      (
        await api.get(
          `/admin/products/${productId}?fields=*variants,*variants.prices`,
          adminHeaders
        )
      ).data.product

    it("previews the batch and creates nothing", async () => {
      const { adminHeaders, unique } = await setup()
      const { runIds } = await twoCompletedRunsOfOneDesign(adminHeaders, unique)

      const res = await loud("dry-run", () =>
        api.post(
          "/admin/production-runs/approvals",
          { run_ids: runIds, decision: "approve", dry_run: true },
          adminHeaders
        )
      )

      const report = res.data.run_approvals
      expect(report.dry_run).toBe(true)
      expect(report.approved).toHaveLength(2)
      // Two runs, ONE design — the number the list cannot show.
      expect(report.design_ids).toHaveLength(1)
      expect(report.created_product_ids).toEqual([])

      // Nothing was decided.
      for (const runId of runIds) {
        expect((await readRun(adminHeaders, runId)).approval_decision).toBeNull()
      }
    })

    /**
     * 🔴 THE test. Two runs, one design, one product — and approving again
     * must still leave one product with one variant.
     */
    it("creates ONE product for two runs of a design, and is idempotent", async () => {
      const { adminHeaders, unique } = await setup()
      const { runIds } = await twoCompletedRunsOfOneDesign(adminHeaders, unique)

      const first = await loud("approve", () =>
        api.post(
          "/admin/production-runs/approvals",
          { run_ids: runIds, decision: "approve" },
          adminHeaders
        )
      )

      const report = first.data.run_approvals
      expect(report.approved).toHaveLength(2)
      expect(report.created_product_ids).toHaveLength(1)

      const productId = report.created_product_ids[0]
      const product = await readProduct(adminHeaders, productId)
      expect(product.variants).toHaveLength(1)

      // Both runs name the SAME product.
      for (const runId of runIds) {
        const run = await readRun(adminHeaders, runId)
        expect(run.approval_decision).toBe("approved")
        expect(run.approved_product_id).toBe(productId)
        // The work still reads as completed — that is what the partner is paid on.
        expect(run.status).toBe("completed")
      }

      // ---- and again -------------------------------------------------------
      const second = await loud("approve-again", () =>
        api.post(
          "/admin/production-runs/approvals",
          { run_ids: runIds, decision: "approve" },
          adminHeaders
        )
      )
      expect(second.data.run_approvals.created_product_ids).toEqual([])
      expect(second.data.run_approvals.skipped).toHaveLength(2)

      const after = await readProduct(adminHeaders, productId)
      // 🔑 STILL ONE. A second "Custom - <name>" variant here is the defect.
      expect(after.variants).toHaveLength(1)
    })

    /**
     * 🔴 The case the per-design grouping alone does NOT cover, and the one the
     * founder named: a LATER run of a design that was already approved.
     *
     * Inside one batch the design is grouped and the product is created once —
     * so a test that approves two runs together passes whether or not the
     * "already has a product" branch exists. It is the SECOND batch, weeks
     * later, on a recreated or re-run job, that meets
     * `create-product-from-design`'s append-a-variant branch. That is where the
     * design gets listed twice, and this is the test that watches for it.
     */
    it("does not add a second variant when a later run of the same design is approved", async () => {
      const { adminHeaders, unique } = await setup()
      const template = await createTemplate(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique, "later")
      const a = await createPartner(unique, "later-a")
      const b = await createPartner(unique, "later-b")

      const firstRun = await loud("first-run", () =>
        api.post(
          `/admin/designs/${designId}/production-runs`,
          {
            quantity: 10,
            assignments: [
              { partner_id: a.partnerId, quantity: 10, template_names: [template] },
            ],
          },
          adminHeaders
        )
      )
      const runOne = firstRun.data.children[0].id
      await completeRun(runOne, a.partnerHeaders)

      const approvedFirst = await loud("approve-first", () =>
        api.post(
          "/admin/production-runs/approvals",
          { run_ids: [runOne], decision: "approve" },
          adminHeaders
        )
      )
      const productId = approvedFirst.data.run_approvals.created_product_ids[0]
      expect(productId).toBeTruthy()
      expect((await readProduct(adminHeaders, productId)).variants).toHaveLength(1)

      // ---- a second job for the same design, finished later ----------------
      const secondRun = await loud("second-run", () =>
        api.post(
          `/admin/designs/${designId}/production-runs`,
          {
            quantity: 5,
            assignments: [
              { partner_id: b.partnerId, quantity: 5, template_names: [template] },
            ],
          },
          adminHeaders
        )
      )
      const runTwo = secondRun.data.children[0].id
      await completeRun(runTwo, b.partnerHeaders, 5)

      const approvedSecond = await loud("approve-second", () =>
        api.post(
          "/admin/production-runs/approvals",
          { run_ids: [runTwo], decision: "approve" },
          adminHeaders
        )
      )

      /**
       * 🔑 The catalogue FIRST, before any assertion about the report. A
       * second "Custom - <name>" variant here is the defect the issue opened
       * on, and it is a fact about the database — the report is only this
       * code's account of itself, and an account is not evidence.
       */
      const after = await readProduct(adminHeaders, productId)
      expect(after.variants).toHaveLength(1)

      const report = approvedSecond.data.run_approvals
      expect(report.approved).toEqual([runTwo])
      // Nothing new was created — the design was already listed.
      expect(report.created_product_ids).toEqual([])
      expect(report.runs[0].product_existed).toBe(true)
      expect(report.runs[0].product_id).toBe(productId)

      // And the later run names the same product it was folded into.
      expect((await readRun(adminHeaders, runTwo)).approved_product_id).toBe(productId)
    })

    /** The design was costed in INR; listing it in USD is the bug (#1805). */
    it("lists the product in the design's currency, not usd", async () => {
      const { adminHeaders, unique } = await setup()
      const { runIds } = await twoCompletedRunsOfOneDesign(adminHeaders, unique)

      const res = await loud("approve-currency", () =>
        api.post(
          "/admin/production-runs/approvals",
          { run_ids: runIds, decision: "approve" },
          adminHeaders
        )
      )

      const productId = res.data.run_approvals.created_product_ids[0]
      const product = await readProduct(adminHeaders, productId)
      const currencies = (product.variants?.[0]?.prices ?? []).map(
        (p: any) => p.currency_code
      )
      expect(currencies).toContain("inr")
      expect(currencies).not.toContain("usd")
    })

    it("rejects without creating anything, and keeps the run completed", async () => {
      const { adminHeaders, unique } = await setup()
      const { runIds } = await twoCompletedRunsOfOneDesign(adminHeaders, unique)

      const res = await loud("reject", () =>
        api.post(
          "/admin/production-runs/approvals",
          {
            run_ids: [runIds[0]],
            decision: "reject",
            reason: "Dye lot off-shade",
          },
          adminHeaders
        )
      )

      expect(res.data.run_approvals.rejected).toEqual([runIds[0]])
      expect(res.data.run_approvals.created_product_ids).toEqual([])

      const run = await readRun(adminHeaders, runIds[0])
      expect(run.approval_decision).toBe("rejected")
      expect(run.approval_reason).toBe("Dye lot off-shade")
      expect(run.approved_product_id).toBeNull()
      // 🔴 Still completed. The goods were made and are still billable.
      expect(run.status).toBe("completed")
    })

    it("refuses a rejection with no reason", async () => {
      const { adminHeaders, unique } = await setup()
      const { runIds } = await twoCompletedRunsOfOneDesign(adminHeaders, unique)

      await expect(
        api.post(
          "/admin/production-runs/approvals",
          { run_ids: runIds, decision: "reject" },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    /** The queue: completed runs nobody has decided about. */
    it("lists only the runs awaiting review", async () => {
      const { adminHeaders, unique } = await setup()
      const { runIds } = await twoCompletedRunsOfOneDesign(adminHeaders, unique)

      await api.post(
        "/admin/production-runs/approvals",
        { run_ids: [runIds[0]], decision: "reject", reason: "Off-shade" },
        adminHeaders
      )

      const res = await api.get(
        "/admin/production-runs?status=completed&approval_decision=none&limit=100",
        adminHeaders
      )
      const ids = res.data.production_runs.map((r: any) => r.id)
      expect(ids).toContain(runIds[1])
      // The decided one has LEFT the queue — the whole point of the column.
      expect(ids).not.toContain(runIds[0])
    })
  })
})
