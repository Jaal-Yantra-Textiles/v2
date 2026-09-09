import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

/**
 * #1877 — a parent production run is a HEADING over its children, so its
 * `quantity` and `produced_quantity` must be the sum of theirs. Three code
 * paths complete a parent and only two of them reconciled the totals, so a
 * completed parent could read `produced_quantity: null` beside children that
 * each stated a real number. Every downstream reader (cost summary, payout,
 * provenance, order fulfilment) then falls back to the ORDERED quantity and
 * assumes it was all made.
 *
 * These cases assert the OBSERVABLE contract at the HTTP + DB boundary:
 * whatever the children reported is what the parent says. The rollup's own
 * arithmetic — and the fallback rule the backfill must not use — is pinned
 * separately in `parent-run-rollup.unit.spec.ts`.
 */
setupSharedTestSuite(() => {
  describe("Production run — parent rolls up its children's output (#1877)", () => {
    const { api, getContainer } = getSharedTestEnv()

    /** POST that surfaces the server's message instead of a bare 400. */
    async function post(url: string, body: any, headers?: any) {
      try {
        return headers === undefined
          ? await api.post(url, body)
          : await api.post(url, body, headers)
      } catch (e: any) {
        const d = e?.response?.data
        throw new Error(
          `POST ${url} -> status=${e?.response?.status} msg=${e?.message} body=${
            typeof d === "string" ? d : JSON.stringify(d)
          }`
        )
      }
    }

    async function setup() {
      const container = getContainer()
      const unique = Date.now() + Math.floor(Math.random() * 1000)
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      return { adminHeaders, unique }
    }

    async function createPartner(unique: number, tag: string) {
      const email = `rollup-${tag}-${unique}@jyt.test`
      const password = "supersecret"
      await post("/auth/partner/emailpass/register", { email, password })
      let login = await post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${login.data.token}` }
      const res = await post(
        "/partners",
        {
          name: `Rollup Partner ${tag} ${unique}`,
          handle: `rollup-${tag}-${unique}`,
          admin: { email, first_name: "Roll", last_name: "Up" },
        },
        { headers }
      )
      expect(res.status).toBe(200)
      login = await post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id,
        partnerHeaders: { Authorization: `Bearer ${login.data.token}` },
      }
    }

    async function createTemplate(adminHeaders: any, name: string) {
      const res = await post(
        "/admin/task-templates",
        {
          name,
          description: "Rollup dispatch step",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run" },
          category: "Production",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.task_template.id as string
    }

    async function createDesign(adminHeaders: any, unique: number) {
      const res = await post(
        "/admin/designs",
        {
          name: `Rollup Design ${unique}`,
          description: "Design for parent rollup test",
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
     * A run is created `approved`, and a partner cannot accept from there —
     * it has to be DISPATCHED first. Leaving this out is what made the first
     * draft of this spec fail four ways with an opaque 400.
     */
    async function advanceToFinished(
      runId: string,
      partnerHeaders: any,
      adminHeaders: any,
      templateId: string
    ) {
      const sent = await post(
        `/admin/production-runs/${runId}/send-to-production`,
        { template_ids: [templateId] },
        adminHeaders
      )
      expect([200, 201]).toContain(sent.status)
      await post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
    }

    /** Read the parent straight from the DB — not from a response echo. */
    async function readRun(runId: string) {
      const query: any = getContainer().resolve("query")
      const { data } = await query.graph({
        entity: "production_runs",
        fields: ["id", "status", "quantity", "produced_quantity", "completed_at"],
        filters: { id: runId },
      })
      return data?.[0]
    }

    // ── Case 1: one child, output stated ────────────────────────────
    it("carries a single child's produced quantity onto the parent", async () => {
      const { adminHeaders, unique } = await setup()
      const { partnerId, partnerHeaders } = await createPartner(unique, "solo")
      const designId = await createDesign(adminHeaders, unique)
      const templateId = await createTemplate(adminHeaders, `rollup-tpl-${unique}-${Math.random().toString(36).slice(2, 8)}`)

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        { assignments: [{ partner_id: partnerId, quantity: 4 }] },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const parentId = createRes.data.production_run.id
      const childId = createRes.data.children[0].id

      await advanceToFinished(childId, partnerHeaders, adminHeaders, templateId)
      const done = await post(
        `/partners/production-runs/${childId}/complete`,
        { produced_quantity: 4 },
        { headers: partnerHeaders }
      )
      expect(done.status).toBe(200)

      const parent = await readRun(parentId)
      expect(parent.status).toBe("completed")
      // The defect: this was null while the child said 4.
      expect(Number(parent.produced_quantity)).toBe(4)
      expect(Number(parent.quantity)).toBe(4)
    })

    // ── Case 2: two children, both state output ─────────────────────
    it("sums two children's output onto the parent", async () => {
      const { adminHeaders, unique } = await setup()
      const a = await createPartner(unique, "a")
      const b = await createPartner(unique + 1, "b")
      const designId = await createDesign(adminHeaders, unique)
      const templateId = await createTemplate(adminHeaders, `rollup-tpl-${unique}-${Math.random().toString(36).slice(2, 8)}`)

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: a.partnerId, quantity: 3, role: "cutting" },
            { partner_id: b.partnerId, quantity: 2, role: "stitching" },
          ],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const parentId = createRes.data.production_run.id
      const children = createRes.data.children
      expect(children.length).toBe(2)

      const byPartner = new Map<string, string>(
        children.map((c: any) => [String(c.partner_id), c.id])
      )
      const childA = byPartner.get(a.partnerId)!
      const childB = byPartner.get(b.partnerId)!

      // Finish the FIRST child only — the parent must not complete yet.
      await advanceToFinished(childA, a.partnerHeaders, adminHeaders, templateId)
      await post(
        `/partners/production-runs/${childA}/complete`,
        { produced_quantity: 3 },
        { headers: a.partnerHeaders }
      )

      const midway = await readRun(parentId)
      expect(midway.status).not.toBe("completed")

      await advanceToFinished(childB, b.partnerHeaders, adminHeaders, templateId)
      await post(
        `/partners/production-runs/${childB}/complete`,
        { produced_quantity: 2 },
        { headers: b.partnerHeaders }
      )

      const parent = await readRun(parentId)
      expect(parent.status).toBe("completed")
      expect(Number(parent.produced_quantity)).toBe(5)
      expect(Number(parent.quantity)).toBe(5)
    })

    // ── Case 3: a real shortfall must not round up ───────────────────
    /**
     * 3 ordered, 2 good + 1 rejected. The parent must say 2 — the number the
     * partner is owed for and the number that actually exists. Reading the
     * ordered 3 here is the exact overstatement this thread is about.
     */
    it("reports the good output, not the ordered quantity, when some were rejected", async () => {
      const { adminHeaders, unique } = await setup()
      const { partnerId, partnerHeaders } = await createPartner(unique, "short")
      const designId = await createDesign(adminHeaders, unique)
      const templateId = await createTemplate(adminHeaders, `rollup-tpl-${unique}-${Math.random().toString(36).slice(2, 8)}`)

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        { assignments: [{ partner_id: partnerId, quantity: 3 }] },
        adminHeaders
      )
      const parentId = createRes.data.production_run.id
      const childId = createRes.data.children[0].id

      await advanceToFinished(childId, partnerHeaders, adminHeaders, templateId)
      const done = await post(
        `/partners/production-runs/${childId}/complete`,
        {
          produced_quantity: 2,
          rejected_quantity: 1,
          rejection_reason: "fabric_flaw",
          rejection_notes: "Slub through the panel",
        },
        { headers: partnerHeaders }
      )
      expect(done.status).toBe(200)

      const parent = await readRun(parentId)
      expect(parent.status).toBe("completed")
      expect(Number(parent.produced_quantity)).toBe(2)
      expect(Number(parent.quantity)).toBe(3)
      // 2 made against 3 ordered — the gap must remain visible on the parent.
      expect(Number(parent.produced_quantity)).toBeLessThan(Number(parent.quantity))
    })

    // ── Case 4: the parent's completed_at is the LAST child's ────────
    it("stamps the parent completed_at from its children, not from now", async () => {
      const { adminHeaders, unique } = await setup()
      const { partnerId, partnerHeaders } = await createPartner(unique, "when")
      const designId = await createDesign(adminHeaders, unique)
      const templateId = await createTemplate(adminHeaders, `rollup-tpl-${unique}-${Math.random().toString(36).slice(2, 8)}`)

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        { assignments: [{ partner_id: partnerId, quantity: 1 }] },
        adminHeaders
      )
      const parentId = createRes.data.production_run.id
      const childId = createRes.data.children[0].id

      await advanceToFinished(childId, partnerHeaders, adminHeaders, templateId)
      await post(
        `/partners/production-runs/${childId}/complete`,
        { produced_quantity: 1 },
        { headers: partnerHeaders }
      )

      const parent = await readRun(parentId)
      const child = await readRun(childId)
      expect(parent.completed_at).toBeTruthy()
      expect(child.completed_at).toBeTruthy()
      /**
       * EXACT equality, to the millisecond. Comparing to the nearest second
       * passed against the old `new Date()` too — in a test the cascade runs
       * within the same second as the work it is dating, so a coarse
       * assertion cannot tell "dated by the child" from "dated by now" and
       * certifies nothing.
       */
      expect(new Date(parent.completed_at).getTime()).toBe(
        new Date(child.completed_at).getTime()
      )
    })
  })
})
