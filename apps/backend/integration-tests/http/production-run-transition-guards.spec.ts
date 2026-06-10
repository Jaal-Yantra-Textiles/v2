import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

// Production-run transition rules live in ONE place —
// ProductionPolicyService (modules/production_policy). These tests pin the
// partner work-lifecycle ordering + terminal guards end-to-end through the
// /partners/production-runs endpoints.
setupSharedTestSuite(() => {
  describe("Production run transition guards (policy)", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }

    async function createPartner(unique: number) {
      const email = `run-guard-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      let login = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${login.data.token}` }
      const res = await api.post(
        "/partners",
        {
          name: `Run Guard ${unique}`,
          handle: `run-guard-${unique}`,
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
          name: `Run Guard Design ${unique}`,
          description: "x",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    /** Create a run for the partner and force a specific status directly. */
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

    async function post(path: string, body: any, headers: any) {
      return api.post(path, body, { headers, validateStatus: () => true })
    }

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
    })

    it("rejects accept on a cancelled run", async () => {
      const unique = Date.now()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "cancelled", {
        cancelled_at: new Date(),
      })

      const res = await post(`/partners/production-runs/${runId}/accept`, {}, partnerHeaders)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it("rejects start before accept (sent_to_partner)", async () => {
      const unique = Date.now() + 1
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "sent_to_partner")

      const res = await post(`/partners/production-runs/${runId}/start`, {}, partnerHeaders)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it("rejects double-start", async () => {
      const unique = Date.now() + 2
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
        started_at: new Date(),
      })

      const res = await post(`/partners/production-runs/${runId}/start`, {}, partnerHeaders)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(String(res.data?.message || res.data?.error || "")).toContain("already")
    })

    it("rejects finish before start", async () => {
      const unique = Date.now() + 3
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
      })

      const res = await post(`/partners/production-runs/${runId}/finish`, {}, partnerHeaders)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it("rejects complete before finish", async () => {
      const unique = Date.now() + 4
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
        started_at: new Date(),
      })

      const res = await post(`/partners/production-runs/${runId}/complete`, {}, partnerHeaders)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it("rejects decline once work has started; allows it pre-work", async () => {
      const unique = Date.now() + 5
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const designId = await createDesign(unique)

      // Started run — decline blocked (mid-flight cancel is admin-only)
      const startedRunId = await createRunWithStatus(designId, partnerId, "in_progress", {
        accepted_at: new Date(),
        started_at: new Date(),
      })
      const blocked = await post(
        `/partners/production-runs/${startedRunId}/decline`,
        { reason: "capacity" },
        partnerHeaders
      )
      expect(blocked.status).toBeGreaterThanOrEqual(400)

      // Pre-work run — decline allowed
      const freshRunId = await createRunWithStatus(designId, partnerId, "sent_to_partner")
      const ok = await post(
        `/partners/production-runs/${freshRunId}/decline`,
        { reason: "capacity" },
        partnerHeaders
      )
      expect(ok.status).toBe(200)
      expect(ok.data.production_run.status).toBe("cancelled")

      // Idempotent: declining the already-cancelled run is a 200 no-op
      const again = await post(
        `/partners/production-runs/${freshRunId}/decline`,
        { reason: "capacity" },
        partnerHeaders
      )
      expect(again.status).toBe(200)
      expect(String(again.data.message || "")).toContain("Already cancelled")
    })

    it("walks the happy path: accept → start → finish → complete", async () => {
      const unique = Date.now() + 6
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const designId = await createDesign(unique)
      const runId = await createRunWithStatus(designId, partnerId, "sent_to_partner")

      const accept = await post(`/partners/production-runs/${runId}/accept`, {}, partnerHeaders)
      expect(accept.status).toBe(200)

      const start = await post(`/partners/production-runs/${runId}/start`, {}, partnerHeaders)
      expect(start.status).toBe(200)

      const finish = await post(`/partners/production-runs/${runId}/finish`, {}, partnerHeaders)
      expect(finish.status).toBe(200)

      const complete = await post(
        `/partners/production-runs/${runId}/complete`,
        { produced_quantity: 1 },
        partnerHeaders
      )
      expect(complete.status).toBe(200)
      expect(complete.data.production_run.status).toBe("completed")
    })
  })
})
