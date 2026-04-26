import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("Production Run — consumption logs, ownership, concurrency", () => {
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
      const email = `guard-partner${suffix}-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      let loginRes = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${loginRes.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Guard Partner${suffix} ${unique}`,
          handle: `guard-partner${suffix}-${unique}`,
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
      const cuttingName = `guard-cutting-${unique}`
      const stitchingName = `guard-stitching-${unique}`

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
          category: "Guard Test",
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
          name: `Guard Design ${unique}`,
          description: "Design for guard integration test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    it("should log, list, and scope consumption logs + reject non-owner + handle concurrent completion", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique, "owner")
      const { partnerHeaders: otherHeaders } = await createPartner(unique, "other")
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      // Create inventory item for consumption test
      const invRes = await api.post(
        "/admin/inventory-items",
        { title: `Test Fabric ${unique}`, description: "For consumption test" },
        adminHeaders
      )
      expect(invRes.status).toBe(200)
      const inventoryItemId = invRes.data.inventory_item.id

      // Create + dispatch run
      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: partnerId, quantity: 2, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      // --- Ownership guards ---

      // Other partner → accept should fail
      try {
        await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: otherHeaders })
        fail("should reject")
      } catch (e: any) {
        expect([400, 404]).toContain(e.response.status)
      }

      // Owner accepts + starts
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })

      // Other partner → finish should fail
      try {
        await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: otherHeaders })
        fail("should reject")
      } catch (e: any) {
        expect([400, 404]).toContain(e.response.status)
      }

      // Other partner → consumption-logs should fail
      try {
        await api.post(
          `/partners/production-runs/${runId}/consumption-logs`,
          { inventoryItemId: "fake-inv", quantity: 1, unitOfMeasure: "Meter", consumptionType: "production" },
          { headers: otherHeaders }
        )
        fail("should reject")
      } catch (e: any) {
        expect([400, 404]).toContain(e.response.status)
      }

      // --- Consumption logging ---

      // Log consumption
      const logRes = await api.post(
        `/partners/production-runs/${runId}/consumption-logs`,
        {
          inventoryItemId,
          quantity: 5,
          unitOfMeasure: "Meter",
          consumptionType: "production",
          notes: "Test log",
        },
        { headers: partnerHeaders }
      )
      expect(logRes.status).toBe(201)
      expect(logRes.data.consumption_log).toBeDefined()

      // List consumption logs — scoped to this run
      const logsRes = await api.get(
        `/partners/production-runs/${runId}/consumption-logs`,
        { headers: partnerHeaders }
      )
      expect(logsRes.status).toBe(200)
      expect(logsRes.data.logs.length).toBe(1)
      expect(logsRes.data.count).toBe(1)

      // Verify logs belong to this run
      for (const log of logsRes.data.logs) {
        expect(log.production_run_id || log.metadata?.production_run_id).toBe(runId)
      }

      // --- Finish + concurrent completion ---

      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })

      // Other partner → complete should fail
      try {
        await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: otherHeaders })
        fail("should reject")
      } catch (e: any) {
        expect([400, 404]).toContain(e.response.status)
      }

      // Get tasks for concurrent completion test
      const runDetail = await api.get(
        `/partners/production-runs/${runId}`,
        { headers: partnerHeaders }
      )
      const tasks = runDetail.data.tasks || []
      const subtasks = tasks.filter((t: any) => !t.title.startsWith("production-run-"))

      // Complete subtasks AND call /complete concurrently
      const taskCompletions = subtasks.map(async (task: any) => {
        try {
          await api.post(`/partners/assigned-tasks/${task.id}/accept`, {}, { headers: partnerHeaders })
        } catch { /* May already be accepted */ }
        try {
          await api.post(`/partners/assigned-tasks/${task.id}/finish`, {}, { headers: partnerHeaders })
        } catch { /* May already be finished */ }
      })

      const directComplete = api.post(
        `/partners/production-runs/${runId}/complete`,
        { produced_quantity: 2, notes: "Race test" },
        { headers: partnerHeaders }
      ).catch((e: any) => e.response)

      await Promise.all([Promise.all(taskCompletions), directComplete])

      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Run should be completed exactly once
      const finalDetail = await api.get(
        `/partners/production-runs/${runId}`,
        { headers: partnerHeaders }
      )
      expect(finalDetail.data.production_run.status).toBe("completed")
      expect(finalDetail.data.production_run.completed_at).toBeDefined()
    })
  })
})
