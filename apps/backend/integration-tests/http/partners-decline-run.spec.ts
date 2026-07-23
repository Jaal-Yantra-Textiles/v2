import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API — POST /partners/production-runs/:id/decline", () => {
    /**
     * Bootstraps a partner admin account and returns an auth token for
     * calls into the partner API. Mirrors the pattern in
     * partners-production-runs.spec.ts so both files use identical auth
     * plumbing (no helper extraction needed).
     */
    const registerLoginCreatePartner = async (unique: number, label: string) => {
      const email = `decline-${label}-${unique}@medusa-test.com`

      await api.post("/auth/partner/emailpass/register", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      const login1 = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers1 = { Authorization: `Bearer ${login1.data.token}` }

      const partnerRes: any = await api
        .post(
          "/partners",
          {
            name: `Decline ${label} ${unique}`,
            handle: `decline-${label}-${unique}`,
            admin: {
              email,
              first_name: "Partner",
              last_name: label,
            },
          },
          { headers: headers1 }
        )
        .catch((err: any) => err.response)
      expect(partnerRes?.status).toBe(200)
      const partnerId = partnerRes.data.partner.id

      const login2 = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers2 = { Authorization: `Bearer ${login2.data.token}` }

      return { partnerId, headers: headers2 }
    }

    it("accepts a valid decline, refuses cross-partner/invalid/started runs", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      const unique = Date.now()
      const a = await registerLoginCreatePartner(unique, "A")
      const b = await registerLoginCreatePartner(unique, "B")

      // Templates required by start-dispatch / resume-dispatch so we can
      // get bRun into "sent_to_partner" — the only status `assertCanAccept`
      // allows. aRun stays at "approved" (decline doesn't gate on status).
      const tplA = await api.post(
        "/admin/task-templates",
        {
          name: `decline-step-a-${unique}`,
          description: "decline spec step A",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run" },
          category: "Production",
        },
        adminHeaders
      )
      expect(tplA.status).toBe(201)
      const tplB = await api.post(
        "/admin/task-templates",
        {
          name: `decline-step-b-${unique}`,
          description: "decline spec step B",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run" },
          category_id: tplA.data.task_template.category_id,
        },
        adminHeaders
      )
      expect(tplB.status).toBe(201)

      // Create a design and a parent run, then approve with both partners
      // assigned — gives us 2 child runs so we can decline one and keep
      // the other for the cross-partner + started checks.
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Decline Spec ${unique}`,
          description: "Design used by partner decline spec",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      const parent = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 10 },
        adminHeaders
      )
      expect(parent.status).toBe(201)
      const parentRunId = parent.data.production_run.id

      const approve = await api.post(
        `/admin/production-runs/${parentRunId}/approve`,
        {
          assignments: [
            { partner_id: a.partnerId, role: "cutting", quantity: 5 },
            { partner_id: b.partnerId, role: "stitching", quantity: 5 },
          ],
        },
        adminHeaders
      )
      expect(approve.status).toBe(200)

      const children = approve.data.result?.children || []
      const aRun = children.find(
        (c: any) => (c?.partner_id ?? c?.partnerId) === a.partnerId
      )
      const bRun = children.find(
        (c: any) => (c?.partner_id ?? c?.partnerId) === b.partnerId
      )
      expect(aRun?.id).toBeTruthy()
      expect(bRun?.id).toBeTruthy()

      // ── 1. Unauthenticated decline → 401 ────────────────────────────────
      const noAuth = await api.post(
        `/partners/production-runs/${aRun.id}/decline`,
        { reason: "capacity" },
        { validateStatus: () => true }
      )
      expect(noAuth.status).toBe(401)

      // ── 2. Invalid reason → 400 ─────────────────────────────────────────
      const badReason = await api.post(
        `/partners/production-runs/${aRun.id}/decline`,
        { reason: "mercury-retrograde" },
        { headers: a.headers, validateStatus: () => true }
      )
      expect(badReason.status).toBe(400)

      // ── 3. Cross-partner decline → should be NOT_ALLOWED ────────────────
      // Partner B trying to decline a run assigned to Partner A
      const cross = await api.post(
        `/partners/production-runs/${aRun.id}/decline`,
        { reason: "capacity" },
        { headers: b.headers, validateStatus: () => true }
      )
      expect([403, 404]).toContain(cross.status)

      // ── 4. Valid decline by owner → 200, run queued for reassignment ────
      // #1093: decline now REASSIGNS (unassign + awaiting_reassignment), it
      // no longer cancels. The attribution string is retained on
      // cancelled_reason for the admin feed, and the partner is unassigned.
      const ok = await api.post(
        `/partners/production-runs/${aRun.id}/decline`,
        { reason: "capacity", notes: "Machine servicing this week" },
        { headers: a.headers, validateStatus: () => true }
      )
      expect(ok.status).toBe(200)
      expect(ok.data.production_run.status).toBe("awaiting_reassignment")
      expect(ok.data.production_run.partner_id).toBeFalsy()
      expect(ok.data.production_run.previous_partner_id).toBe(a.partnerId)
      expect(ok.data.production_run.cancelled_reason).toMatch(/capacity/i)
      expect(ok.data.production_run.cancelled_reason).toMatch(/Machine servicing/)

      // ── 5. Idempotent re-decline → 200 with "Already queued" ────────────
      // partner_id is now null, so the ownership check would 404 — the route
      // short-circuits on the awaiting_reassignment status instead.
      const second = await api.post(
        `/partners/production-runs/${aRun.id}/decline`,
        { reason: "capacity" },
        { headers: a.headers, validateStatus: () => true }
      )
      expect(second.status).toBe(200)
      expect(second.data.message).toMatch(/already/i)

      // ── 6. Started run (started_at set) → 403, not allowed ──────────────
      // Accept + start Partner B's run so started_at is populated, then
      // try to decline — the route must refuse because work has begun.
      // First, dispatch bRun to drive it to "sent_to_partner" so
      // assertCanAccept passes (mirrors whatsapp-partner-flow.spec.ts).
      const sd = await api.post(
        `/admin/production-runs/${bRun.id}/start-dispatch`,
        {},
        adminHeaders
      )
      expect(sd.status).toBe(202)
      const rd = await api.post(
        `/admin/production-runs/${bRun.id}/resume-dispatch`,
        { transaction_id: sd.data.transaction_id, template_names: [tplA.data.task_template.name, tplB.data.task_template.name] },
        adminHeaders
      )
      expect(rd.status).toBe(200)
      const dispatchDeadline = Date.now() + 15_000
      while (Date.now() < dispatchDeadline) {
        const r = await api.get(`/admin/production-runs/${bRun.id}`, adminHeaders)
        if (String(r.data.production_run?.status) === "sent_to_partner") break
        await new Promise((r) => setTimeout(r, 500))
      }

      const accept = await api.post(
        `/partners/production-runs/${bRun.id}/accept`,
        {},
        { headers: b.headers, validateStatus: () => true }
      )
      expect(accept.status).toBe(200)
      const start = await api.post(
        `/partners/production-runs/${bRun.id}/start`,
        {},
        { headers: b.headers, validateStatus: () => true }
      )
      expect(start.status).toBe(200)

      const declineStarted = await api.post(
        `/partners/production-runs/${bRun.id}/decline`,
        { reason: "capacity" },
        { headers: b.headers, validateStatus: () => true }
      )
      expect([400, 403]).toContain(declineStarted.status)
      // Confirm the started run wasn't silently cancelled despite the 4xx
      const bStillLive = await api
        .get(`/partners/production-runs/${bRun.id}`, { headers: b.headers })
        .catch((err: any) => err.response)
      expect(bStillLive.status).toBe(200)
      expect(bStillLive.data.production_run.status).not.toBe("cancelled")
    })
  })
})
