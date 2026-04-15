import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

const TEST_PARTNER_PASSWORD = "supersecret"

setupSharedTestSuite(() => {
  describe("Sample Production Run → Design Status", () => {
    const { api, getContainer } = getSharedTestEnv()

    async function setupTestData() {
      const container = getContainer()
      const unique = Date.now()

      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      const emailTemplates = [
        {
          name: "Admin Partner Created",
          template_key: "partner-created-from-admin",
          subject: "Partner account at {{partner_name}}",
          html_content: `<div>Partner {{partner_name}} created.</div>`,
          from: "partners@jaalyantra.com",
          variables: { partner_name: "name", temp_password: "pwd" },
          template_type: "email",
        },
        {
          name: "Design Production Started",
          template_key: "design-production-started",
          subject: "Production started for {{design_name}}",
          html_content: `<div>Production for {{design_name}} has started.</div>`,
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
        {
          name: "Design Production Completed",
          template_key: "design-production-completed",
          subject: "Production completed for {{design_name}}",
          html_content: `<div>Production for {{design_name}} is complete.</div>`,
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
      ]

      for (const tpl of emailTemplates) {
        try {
          await api.post("/admin/email-templates", tpl, adminHeaders)
        } catch {
          // ok
        }
      }

      return { adminHeaders, unique }
    }

    async function createPartner(unique: number) {
      const email = `sample-status-partner-${unique}@jyt.test`

      await api.post("/auth/partner/emailpass/register", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      let loginRes = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      let headers = { Authorization: `Bearer ${loginRes.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Sample Status Partner ${unique}`,
          handle: `sample-status-partner-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)

      loginRes = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      headers = { Authorization: `Bearer ${loginRes.data.token}` }

      return { partnerId: res.data.partner.id, partnerHeaders: headers }
    }

    async function createTemplates(adminHeaders: any, unique: number) {
      const cuttingName = `sample-cutting-${unique}`
      const stitchingName = `sample-stitching-${unique}`

      const cuttingRes = await api.post(
        "/admin/task-templates",
        {
          name: cuttingName,
          description: "Cutting",
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Sample Status Test",
        },
        adminHeaders
      )
      expect(cuttingRes.status).toBe(201)

      const stitchingRes = await api.post(
        "/admin/task-templates",
        {
          name: stitchingName,
          description: "Stitching",
          priority: "medium",
          estimated_duration: 90,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category_id: cuttingRes.data.task_template.category_id,
        },
        adminHeaders
      )
      expect(stitchingRes.status).toBe(201)

      return { cuttingName, stitchingName }
    }

    it("should transition design to Sample_Production when sample run starts", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)

      // Create design in Approved status
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Sample-Design ${unique}`,
          description: "Test sample run design status transition",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      // Create sample run
      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          run_type: "sample",
          assignments: [
            { partner_id: partnerId, quantity: 1, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      // Accept
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })

      // Start sample run → design should transition to Sample_Production
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })

      const designAfterStart = await api.get(`/admin/designs/${designId}`, adminHeaders)
      expect(designAfterStart.data.design.status).toBe("Sample_Production")

      // Complete lifecycle to clean up
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })
    })
  })
})
