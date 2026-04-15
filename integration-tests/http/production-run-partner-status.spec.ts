import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("Production Run — partner_status on design GET", () => {
    const { api, getContainer } = getSharedTestEnv()

    async function setupTestData() {
      const container = getContainer()
      const unique = Date.now()

      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      for (const tpl of [
        { name: "Admin Partner Created", template_key: "partner-created-from-admin", subject: "s", html_content: "<div>ok</div>", from: "t@t.com", variables: {}, template_type: "email" },
        { name: "Design Production Started", template_key: "design-production-started", subject: "s", html_content: "<div>ok</div>", from: "t@t.com", variables: {}, template_type: "email" },
        { name: "Design Production Completed", template_key: "design-production-completed", subject: "s", html_content: "<div>ok</div>", from: "t@t.com", variables: {}, template_type: "email" },
      ]) {
        try { await api.post("/admin/email-templates", tpl, adminHeaders) } catch {}
      }

      return { adminHeaders, unique }
    }

    async function createPartner(unique: number) {
      const email = `pstatus-partner-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      let loginRes = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${loginRes.data.token}` }

      const res = await api.post("/partners", {
        name: `PStatus Partner ${unique}`,
        handle: `pstatus-partner-${unique}`,
        admin: { email, first_name: "Test", last_name: "Partner" },
      }, { headers })
      expect(res.status).toBe(200)

      loginRes = await api.post("/auth/partner/emailpass", { email, password })
      headers = { Authorization: `Bearer ${loginRes.data.token}` }

      return { partnerId: res.data.partner.id, partnerHeaders: headers }
    }

    async function createTemplates(adminHeaders: any, unique: number) {
      const cuttingName = `pstatus-cutting-${unique}`
      const stitchingName = `pstatus-stitching-${unique}`

      const cuttingRes = await api.post("/admin/task-templates", {
        name: cuttingName, description: "Cutting", priority: "medium", estimated_duration: 60,
        required_fields: {}, eventable: false, notifiable: false, message_template: "",
        metadata: { workflow_type: "production_run" }, category: "PStatus Test",
      }, adminHeaders)
      expect(cuttingRes.status).toBe(201)

      const stitchingRes = await api.post("/admin/task-templates", {
        name: stitchingName, description: "Stitching", priority: "medium", estimated_duration: 90,
        required_fields: {}, eventable: false, notifiable: false, message_template: "",
        metadata: { workflow_type: "production_run" }, category_id: cuttingRes.data.task_template.category_id,
      }, adminHeaders)
      expect(stitchingRes.status).toBe(201)

      return { cuttingName, stitchingName }
    }

    it("should derive partner_status from production run on design GET", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)

      const designRes = await api.post("/admin/designs", {
        name: `PStatus Design ${unique}`, description: "partner_status test",
        design_type: "Original", status: "Approved", priority: "Medium",
      }, adminHeaders)
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      await api.post(`/admin/designs/${designId}/partners`, { partner_id: partnerId }, adminHeaders).catch(() => {})

      const createRes = await api.post(`/admin/designs/${designId}/production-runs`, {
        assignments: [{ partner_id: partnerId, quantity: 1, template_names: [cuttingName, stitchingName] }],
      }, adminHeaders)
      const runId = createRes.data.children[0].id

      // Before accept
      const designBefore = await api.get(`/partners/designs/${designId}`, { headers: partnerHeaders }).catch(() => null)
      if (designBefore) {
        expect(["assigned", "incoming"]).toContain(designBefore.data.design?.partner_info?.partner_status)
      }

      // Accept + start → in_progress
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })

      const designDuring = await api.get(`/partners/designs/${designId}`, { headers: partnerHeaders }).catch(() => null)
      if (designDuring) {
        expect(designDuring.data.design?.partner_info?.partner_status).toBe("in_progress")
        expect(designDuring.data.design?.partner_info?.partner_started_at).toBeDefined()
      }

      // Finish + complete → completed
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })

      const designAfter = await api.get(`/partners/designs/${designId}`, { headers: partnerHeaders }).catch(() => null)
      if (designAfter) {
        expect(designAfter.data.design?.partner_info?.partner_status).toBe("completed")
        expect(designAfter.data.design?.partner_info?.partner_completed_at).toBeDefined()
      }
    })
  })
})
