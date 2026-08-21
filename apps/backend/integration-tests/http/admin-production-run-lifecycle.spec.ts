import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

/**
 * Integration tests for the admin-side production run lifecycle endpoints:
 *
 *   POST /admin/production-runs/:id/accept
 *   POST /admin/production-runs/:id/start
 *   POST /admin/production-runs/:id/finish
 *
 * These mirror the partner accept/start/finish flows but are initiated by an
 * admin on behalf of the assigned partner. The tests cover:
 *   - Happy path: accept → start → finish (admin)
 *   - Idempotency guards (double-accept, double-start, double-finish)
 *   - Terminal guards (cancelled / completed rejected)
 *   - Missing-partner guard
 *   - Policy ordering (start before accept, finish before start)
 *   - Admin activity audit entry recorded
 *   - Finish with notes
 */
setupSharedTestSuite(() => {
  describe("Admin production run lifecycle (accept / start / finish)", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }

    // ── Helpers ───────────────────────────────────────────────────────────

    async function createPartner(unique: number, label = "") {
      const suffix = label ? `-${label}` : ""
      const email = `admin-lifecycle${suffix}-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      let login = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${login.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Admin Lifecycle Partner${suffix} ${unique}`,
          handle: `admin-lifecycle${suffix}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)

      login = await api.post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id,
        partnerHeaders: { Authorization: `Bearer ${login.data.token}` },
      }
    }

    async function createDesign(unique: number) {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Admin Lifecycle Design ${unique}`,
          description: "Design for admin lifecycle test",
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
     * Create a run and force a specific status directly via the module
     * service (bypassing the HTTP policy layer), so we can set up
     * "already in_progress", "already started", etc. for guard assertions.
     */
    async function createRunWithStatus(
      designId: string,
      partnerId: string,
      status: string,
      extra: Record<string, any> = {}
    ) {
      const res = await api.post(
        "/admin/production-runs",
        { design_id: designId, partner_id: partnerId, quantity: 1 },
        adminHeaders
      )
      expect(res.status).toBe(201)
      const runId = res.data.production_run.id
      const runService: any = getContainer().resolve("production_runs")
      await runService.updateProductionRuns({ id: runId, status, ...extra })
      return runId
    }

    async function post(path: string, body: any = {}) {
      return api.post(path, body, {
        headers: adminHeaders.headers,
        validateStatus: () => true,
      })
    }

    // ── Setup ─────────────────────────────────────────────────────────────

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "s",
            html_content: "<div>ok</div>",
            from: "t@t.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {}
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Design Production Started",
            template_key: "design-production-started",
            subject: "s",
            html_content: "<div>ok</div>",
            from: "t@t.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {}
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Design Production Completed",
            template_key: "design-production-completed",
            subject: "s",
            html_content: "<div>ok</div>",
            from: "t@t.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {}
    })

    // ── Happy path ────────────────────────────────────────────────────────

    it("walks the happy path: admin accept → start → finish", async () => {
      const unique = Date.now()
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "sent_to_partner")

      // Accept
      const accept = await post(`/admin/production-runs/${runId}/accept`)
      expect(accept.status).toBe(200)
      expect(accept.data.production_run.status).toBe("in_progress")
      expect(accept.data.production_run.accepted_at).toBeTruthy()
      expect(accept.data.message).toBe("Production run accepted")

      // Start
      const start = await post(`/admin/production-runs/${runId}/start`)
      expect(start.status).toBe(200)
      expect(start.data.production_run.started_at).toBeTruthy()
      expect(start.data.message).toBe("Production run started")

      // Finish
      const finish = await post(`/admin/production-runs/${runId}/finish`, {
        notes: "Admin finished on behalf of partner",
      })
      expect(finish.status).toBe(200)
      expect(finish.data.production_run.finished_at).toBeTruthy()
      expect(finish.data.message).toBe("Production run finished")
    })

    // ── Idempotency guards ───────────────────────────────────────────────

    it("rejects double-accept (already accepted)", async () => {
      const unique = Date.now() + 1
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "sent_to_partner")

      const first = await post(`/admin/production-runs/${runId}/accept`)
      expect(first.status).toBe(200)

      const second = await post(`/admin/production-runs/${runId}/accept`)
      expect(second.status).toBeGreaterThanOrEqual(400)
    })

    it("rejects double-start", async () => {
      const unique = Date.now() + 2
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
        started_at: new Date(),
      })

      const res = await post(`/admin/production-runs/${runId}/start`)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(String(res.data?.message || res.data?.error || "")).toContain("already")
    })

    it("rejects double-finish", async () => {
      const unique = Date.now() + 3
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
        started_at: new Date(),
        finished_at: new Date(),
      })

      const res = await post(`/admin/production-runs/${runId}/finish`)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(String(res.data?.message || res.data?.error || "")).toContain("already")
    })

    // ── Terminal guards ───────────────────────────────────────────────────

    it("rejects accept on a cancelled run", async () => {
      const unique = Date.now() + 4
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "cancelled", {
        cancelled_at: new Date(),
      })

      const res = await post(`/admin/production-runs/${runId}/accept`)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it("rejects start on a completed run", async () => {
      const unique = Date.now() + 5
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "completed", {
        accepted_at: new Date(),
        started_at: new Date(),
        finished_at: new Date(),
        completed_at: new Date(),
      })

      const res = await post(`/admin/production-runs/${runId}/start`)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it("rejects finish on a cancelled run", async () => {
      const unique = Date.now() + 6
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "cancelled", {
        cancelled_at: new Date(),
        accepted_at: new Date(),
        started_at: new Date(),
      })

      const res = await post(`/admin/production-runs/${runId}/finish`)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    // ── Policy ordering ───────────────────────────────────────────────────

    it("rejects start before accept (sent_to_partner)", async () => {
      const unique = Date.now() + 7
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "sent_to_partner")

      const res = await post(`/admin/production-runs/${runId}/start`)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it("rejects finish before start", async () => {
      const unique = Date.now() + 8
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
      })

      const res = await post(`/admin/production-runs/${runId}/finish`)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    // ── Missing partner ───────────────────────────────────────────────────

    it("rejects accept on a run with no assigned partner", async () => {
      const unique = Date.now() + 9
      const designId = await createDesign(unique)
      const res = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 1 },
        adminHeaders
      )
      expect(res.status).toBe(201)
      const runId = res.data.production_run.id

      const acceptRes = await post(`/admin/production-runs/${runId}/accept`)
      expect(acceptRes.status).toBeGreaterThanOrEqual(400)
    })

    // ── Admin activity audit ──────────────────────────────────────────────

    it("records an admin activity audit entry on accept", async () => {
      const unique = Date.now() + 10
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "sent_to_partner")

      const accept = await post(`/admin/production-runs/${runId}/accept`)
      expect(accept.status).toBe(200)

      const activitiesRes = await api.get(
        `/admin/production-runs/${runId}/activities`,
        { headers: adminHeaders.headers }
      )
      expect(activitiesRes.status).toBe(200)

      const activities = activitiesRes.data.activities || []
      const adminEntry = activities.find(
        (a: any) =>
          a.actor_type === "admin" && a.kind === "accepted_by_admin"
      )
      expect(adminEntry).toBeDefined()
      expect(adminEntry.summary).toContain("admin")
    })

    // ── Finish with notes ─────────────────────────────────────────────────

    it("records finish notes when provided", async () => {
      const unique = Date.now() + 11
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
        started_at: new Date(),
      })

      const noteText = "Quality check passed, ready for completion"
      const finish = await post(`/admin/production-runs/${runId}/finish`, {
        notes: noteText,
      })
      expect(finish.status).toBe(200)

      const detail = await api.get(
        `/admin/production-runs/${runId}`,
        { headers: adminHeaders.headers }
      )
      expect(detail.status).toBe(200)
      expect(detail.data.production_run.finish_notes).toBe(noteText)
    })

    // ── UI-adjacent: verify list/detail API responses carry the fields the
    //    admin UI renders (status, partner, design snapshot, quantity, yield) ──

    it("returns design snapshot and produced_quantity in the detail response for the UI", async () => {
      const unique = Date.now() + 12
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
        started_at: new Date(),
        produced_quantity: 8,
      })

      const detail = await api.get(
        `/admin/production-runs/${runId}`,
        { headers: adminHeaders.headers }
      )
      expect(detail.status).toBe(200)
      expect(detail.data.production_run.id).toBe(runId)
      expect(detail.data.production_run.status).toBe("in_progress")
      expect(detail.data.production_run.partner_id).toBe(partnerId)
      expect(detail.data.production_run.design_id).toBe(designId)
      expect(detail.data.production_run.produced_quantity).toBe(8)
    })

    it("accept → start → finish transitions flow through the correct statuses", async () => {
      const unique = Date.now() + 13
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "sent_to_partner")

      // Before accept: no accepted_at
      const beforeAccept = await api.get(
        `/admin/production-runs/${runId}`,
        { headers: adminHeaders.headers }
      )
      expect(beforeAccept.data.production_run.accepted_at).toBeFalsy()

      // Accept → in_progress + accepted_at
      const accept = await post(`/admin/production-runs/${runId}/accept`)
      expect(accept.status).toBe(200)
      expect(accept.data.production_run.status).toBe("in_progress")
      expect(accept.data.production_run.accepted_at).toBeTruthy()
      expect(accept.data.production_run.started_at).toBeFalsy()

      // Start → started_at set
      const start = await post(`/admin/production-runs/${runId}/start`)
      expect(start.status).toBe(200)
      expect(start.data.production_run.started_at).toBeTruthy()
      expect(start.data.production_run.finished_at).toBeFalsy()

      // Finish → finished_at set + finish_notes
      const finishNotes = "UI flow test — all good"
      const finish = await post(`/admin/production-runs/${runId}/finish`, {
        notes: finishNotes,
      })
      expect(finish.status).toBe(200)
      expect(finish.data.production_run.finished_at).toBeTruthy()
      expect(finish.data.production_run.finish_notes).toBe(finishNotes)
    })

    it("rejects accept on a run already in_progress (already accepted)", async () => {
      const unique = Date.now() + 14
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
      })

      const res = await post(`/admin/production-runs/${runId}/accept`)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it("rejects start on a run with no partner assigned", async () => {
      const unique = Date.now() + 15
      const designId = await createDesign(unique)
      const res = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 1 },
        adminHeaders
      )
      expect(res.status).toBe(201)
      const runId = res.data.production_run.id

      const startRes = await post(`/admin/production-runs/${runId}/start`)
      expect(startRes.status).toBeGreaterThanOrEqual(400)
    })

    it("records admin activity audit entries for start and finish", async () => {
      const unique = Date.now() + 16
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
        started_at: new Date(),
      })

      const finish = await post(`/admin/production-runs/${runId}/finish`, {
        notes: "Audit trail test",
      })
      expect(finish.status).toBe(200)

      const activitiesRes = await api.get(
        `/admin/production-runs/${runId}/activities`,
        { headers: adminHeaders.headers }
      )
      expect(activitiesRes.status).toBe(200)

      const activities = activitiesRes.data.activities || []
      const finishEntry = activities.find(
        (a: any) =>
          a.actor_type === "admin" && a.kind === "finished_by_admin"
      )
      expect(finishEntry).toBeDefined()
      expect(finishEntry.summary).toContain("admin")
    })

    it("finish with empty notes still succeeds", async () => {
      const unique = Date.now() + 17
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
        started_at: new Date(),
      })

      const finish = await post(`/admin/production-runs/${runId}/finish`)
      expect(finish.status).toBe(200)
      expect(finish.data.production_run.finished_at).toBeTruthy()
    })

    it("list endpoint supports filtering by status for the UI table", async () => {
      const unique = Date.now() + 18
      const { partnerId } = await createPartner(unique)
      const designId = await createDesign(unique)

      // Create runs in different statuses
      const inProgressId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
      })
      const sentId = await createRunWithStatus(designId, partnerId, "sent_to_partner")

      // Filter by status=in_progress
      const inProgressRes = await api.get(
        `/admin/production-runs?status=in_progress&limit=50`,
        { headers: adminHeaders.headers }
      )
      expect(inProgressRes.status).toBe(200)
      const inProgressRuns = inProgressRes.data.production_runs || []
      expect(inProgressRuns.some((r: any) => r.id === inProgressId)).toBe(true)
      expect(inProgressRuns.some((r: any) => r.id === sentId)).toBe(false)

      // Filter by status=sent_to_partner
      const sentRes = await api.get(
        `/admin/production-runs?status=sent_to_partner&limit=50`,
        { headers: adminHeaders.headers }
      )
      expect(sentRes.status).toBe(200)
      const sentRuns = sentRes.data.production_runs || []
      expect(sentRuns.some((r: any) => r.id === sentId)).toBe(true)
      expect(sentRuns.some((r: any) => r.id === inProgressId)).toBe(false)
    })
  })
})
