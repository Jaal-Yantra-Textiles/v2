import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("Production Run Lifecycle — full lifecycle + basic validations", () => {
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

    async function createPartner(unique: number, label = "") {
      const suffix = label ? `-${label}` : ""
      const email = `lifecycle-partner${suffix}-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      let loginRes = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${loginRes.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Lifecycle Partner${suffix} ${unique}`,
          handle: `lifecycle-partner${suffix}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)

      loginRes = await api.post("/auth/partner/emailpass", { email, password })
      headers = { Authorization: `Bearer ${loginRes.data.token}` }

      return { partnerId: res.data.partner.id, partnerHeaders: headers }
    }

    async function createTemplates(adminHeaders: any, unique: number) {
      const cuttingName = `lifecycle-cutting-${unique}`
      const stitchingName = `lifecycle-stitching-${unique}`

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
          category: "Lifecycle Test",
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

    async function createDesign(adminHeaders: any, unique: number) {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Lifecycle Design ${unique}`,
          description: "Design for lifecycle integration test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    it("should complete full lifecycle and validate guards", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      // Create production run with assignments + dispatch
      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            {
              partner_id: partnerId,
              quantity: 5,
              role: "manufacturing",
              template_names: [cuttingName, stitchingName],
            },
          ],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      expect(createRes.data.children.length).toBe(1)
      const runId = createRes.data.children[0].id

      // Verify sent_to_partner
      const detail = await api.get(
        `/partners/production-runs/${runId}`,
        { headers: partnerHeaders }
      )
      expect(detail.data.production_run.status).toBe("sent_to_partner")
      expect(detail.data.tasks.length).toBeGreaterThan(0)

      // Accept
      const acceptRes = await api.post(
        `/partners/production-runs/${runId}/accept`,
        {},
        { headers: partnerHeaders }
      )
      expect(acceptRes.status).toBe(200)
      expect(acceptRes.data.production_run).toBeDefined()
      expect(acceptRes.data.production_run.id).toBe(runId)
      expect(acceptRes.data.production_run.status).toBe("in_progress")
      expect(acceptRes.data.production_run.accepted_at).toBeDefined()

      // Start
      const startRes = await api.post(
        `/partners/production-runs/${runId}/start`,
        {},
        { headers: partnerHeaders }
      )
      expect(startRes.status).toBe(200)
      expect(startRes.data.message).toBe("Production run started")
      expect(startRes.data.production_run.started_at).toBeDefined()

      // Double-start → 400
      try {
        await api.post(
          `/partners/production-runs/${runId}/start`,
          {},
          { headers: partnerHeaders }
        )
        fail("double-start should throw")
      } catch (e: any) {
        expect(e.response.status).toBe(400)
      }

      // Finish
      const finishRes = await api.post(
        `/partners/production-runs/${runId}/finish`,
        {},
        { headers: partnerHeaders }
      )
      expect(finishRes.status).toBe(200)
      expect(finishRes.data.message).toBe("Production run finished")
      expect(finishRes.data.production_run.finished_at).toBeDefined()

      // Complete
      const completeRes = await api.post(
        `/partners/production-runs/${runId}/complete`,
        {},
        { headers: partnerHeaders }
      )
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.message).toBe("Production run completed")
      expect(completeRes.data.production_run.status).toBe("completed")
      expect(completeRes.data.production_run.completed_at).toBeDefined()

      // Double-complete → 400
      try {
        await api.post(
          `/partners/production-runs/${runId}/complete`,
          {},
          { headers: partnerHeaders }
        )
        fail("double-complete should throw")
      } catch (e: any) {
        expect(e.response.status).toBe(400)
      }

      // run_type filter
      const listRes = await api.get(
        `/partners/production-runs?run_type=production`,
        { headers: partnerHeaders }
      )
      expect(listRes.status).toBe(200)
      expect(Array.isArray(listRes.data.production_runs)).toBe(true)

      // Double-finish on completed run → 400
      try {
        await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
        fail("double-finish after complete should throw")
      } catch (e: any) {
        expect(e.response.status).toBe(400)
      }

      // Block consumption logging on completed run
      try {
        await api.post(
          `/partners/production-runs/${runId}/consumption-logs`,
          { inventoryItemId: "fake-inv", quantity: 5, unitOfMeasure: "Meter", consumptionType: "production" },
          { headers: partnerHeaders }
        )
        fail("Should have blocked")
      } catch (e: any) {
        expect(e.response.status).toBe(400)
      }

      // Block media upload on completed run
      try {
        await api.post(
          `/partners/production-runs/${runId}/media/attach`,
          { media_files: [{ url: "https://example.com/test.jpg" }] },
          { headers: partnerHeaders }
        )
        fail("Should block media on completed run")
      } catch (e: any) {
        expect(e.response.status).toBe(400)
      }
    })

    it("should create a sample production run with run_type", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const designId = await createDesign(adminHeaders, unique)

      const sampleRes = await api.post(
        "/admin/production-runs",
        {
          design_id: designId,
          quantity: 1,
          run_type: "sample",
        },
        adminHeaders
      )
      expect(sampleRes.status).toBe(201)
      expect(sampleRes.data.production_run.run_type).toBe("sample")
    })
  })
})
