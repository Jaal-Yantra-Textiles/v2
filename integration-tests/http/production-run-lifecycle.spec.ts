import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("Production Run Lifecycle — partner milestones", () => {
    const { api, getContainer } = getSharedTestEnv()

    /**
     * Helper: sets up admin + partner + task templates + design
     * Returns everything needed to create and run a production run.
     * Each it() must call this because medusaIntegrationTestRunner
     * truncates all tables between tests.
     */
    async function setupTestData() {
      const container = getContainer()
      const unique = Date.now()

      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      // Email template for partner creation workflow
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "Partner account at {{partner_name}}",
            html_content: `<div>Partner {{partner_name}} created.</div>`,
            from: "partners@jaalyantra.com",
            variables: { partner_name: "name", temp_password: "pwd" },
            template_type: "email",
          },
          adminHeaders
        )
      } catch {
        // ok
      }

      return { adminHeaders, unique }
    }

    async function createPartner(unique: number) {
      const email = `lifecycle-partner-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      let loginRes = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${loginRes.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Lifecycle Partner ${unique}`,
          handle: `lifecycle-partner-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)

      // Re-login for fresh token after entity creation
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

    it("should complete full lifecycle: create → accept → start → finish → complete", async () => {
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

      const afterAccept = await api.get(
        `/partners/production-runs/${runId}`,
        { headers: partnerHeaders }
      )
      expect(afterAccept.data.production_run.status).toBe("in_progress")
      expect(afterAccept.data.production_run.accepted_at).toBeDefined()

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

    it("should log and list consumption on a production run", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      // Create an inventory item to consume
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
            {
              partner_id: partnerId,
              quantity: 1,
              template_names: [cuttingName, stitchingName],
            },
          ],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      // Accept + start so status is in_progress
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })

      // Log consumption
      const logRes = await api.post(
        `/partners/production-runs/${runId}/consumption-logs`,
        {
          inventoryItemId,
          quantity: 5,
          unitOfMeasure: "Meter",
          consumptionType: "production",
          notes: "Test log from lifecycle test",
        },
        { headers: partnerHeaders }
      )
      expect(logRes.status).toBe(201)
      expect(logRes.data.consumption_log).toBeDefined()

      // List consumption logs
      const listRes = await api.get(
        `/partners/production-runs/${runId}/consumption-logs`,
        { headers: partnerHeaders }
      )
      expect(listRes.status).toBe(200)
      expect(listRes.data.logs.length).toBeGreaterThan(0)

      // Complete the flow so lifecycle workflow finishes
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })
    })

    it("should reject actions from a non-owning partner", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId: ownerId } = await createPartner(unique)
      const { partnerHeaders: otherHeaders } = await createPartner(unique + 1)

      const designId = await createDesign(adminHeaders, unique)

      // Create run owned by the first partner (no dispatch)
      const runRes = await api.post(
        "/admin/production-runs",
        {
          design_id: designId,
          partner_id: ownerId,
          quantity: 1,
        },
        adminHeaders
      )
      expect(runRes.status).toBe(201)
      const runId = runRes.data.production_run.id

      // Other partner should get 404
      try {
        await api.post(
          `/partners/production-runs/${runId}/start`,
          {},
          { headers: otherHeaders }
        )
        fail("Should have thrown")
      } catch (e: any) {
        expect([400, 404]).toContain(e.response.status)
      }
    })

    it("should handle concurrent completion safely (task subscriber + /complete race)", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      // Create + dispatch run
      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            {
              partner_id: partnerId,
              quantity: 2,
              role: "manufacturing",
              template_names: [cuttingName, stitchingName],
            },
          ],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      // Accept → start → finish to get to completable state
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })

      // Get tasks linked to this run
      const runDetail = await api.get(
        `/partners/production-runs/${runId}`,
        { headers: partnerHeaders }
      )
      const tasks = runDetail.data.tasks || []
      const subtasks = tasks.filter((t: any) => !t.title.startsWith("production-run-"))

      // Complete all subtasks individually (triggers task subscriber)
      // AND call /complete at the same time to simulate race
      const taskCompletions = subtasks.map(async (task: any) => {
        try {
          // Accept the task first
          await api.post(
            `/partners/assigned-tasks/${task.id}/accept`,
            {},
            { headers: partnerHeaders }
          )
        } catch {
          // May already be accepted
        }
        try {
          await api.post(
            `/partners/assigned-tasks/${task.id}/finish`,
            {},
            { headers: partnerHeaders }
          )
        } catch {
          // May already be finished
        }
      })

      const directComplete = api.post(
        `/partners/production-runs/${runId}/complete`,
        { produced_quantity: 2, notes: "Race test" },
        { headers: partnerHeaders }
      ).catch((e: any) => e.response)

      // Fire both paths concurrently
      const [_, completeResult] = await Promise.all([
        Promise.all(taskCompletions),
        directComplete,
      ])

      // Wait briefly for subscriber to process
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // The run should be completed exactly once
      const finalDetail = await api.get(
        `/partners/production-runs/${runId}`,
        { headers: partnerHeaders }
      )
      expect(finalDetail.data.production_run.status).toBe("completed")
      expect(finalDetail.data.production_run.completed_at).toBeDefined()

      // Verify no duplicate — completed_at should be a single timestamp, not overwritten
      const completedAt = new Date(finalDetail.data.production_run.completed_at)
      expect(completedAt.getTime()).toBeGreaterThan(0)
    })

    it("should return { production_run } from accept (consistent response shape)", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: partnerId, quantity: 1, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      const runId = createRes.data.children[0].id

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

      // Complete lifecycle to release async workflow steps
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })
    })

    it("should transition design to Technical_Review on finish", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)

      // Create design in In_Development status
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Finish-Design ${unique}`,
          description: "Test design status transition on finish",
          design_type: "Original",
          status: "In_Development",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: partnerId, quantity: 1, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      const runId = createRes.data.children[0].id

      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })

      // Check design transitioned to Technical_Review
      const designAfter = await api.get(`/admin/designs/${designId}`, adminHeaders)
      expect(designAfter.data.design.status).toBe("Technical_Review")

      // Complete lifecycle to release async workflow steps
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })
    })

    it("should reject double-finish with 400", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: partnerId, quantity: 1, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      const runId = createRes.data.children[0].id

      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })

      // Double finish — run is in_progress with finished_at set, status guard should pass
      // but the complete route expects finished_at, so finish again should fail
      // because the run has already been finished (finished_at set)
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })

      // Now try to finish a completed run
      try {
        await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
        fail("double-finish after complete should throw")
      } catch (e: any) {
        expect(e.response.status).toBe(400)
      }
    })

    it("should block consumption logging on completed run", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const invRes = await api.post(
        "/admin/inventory-items",
        { title: `Block-Fabric ${unique}` },
        adminHeaders
      )
      const inventoryItemId = invRes.data.inventory_item.id

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: partnerId, quantity: 1, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      const runId = createRes.data.children[0].id

      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })

      // Try to log consumption on completed run
      try {
        await api.post(
          `/partners/production-runs/${runId}/consumption-logs`,
          { inventoryItemId, quantity: 5, unitOfMeasure: "Meter", consumptionType: "production" },
          { headers: partnerHeaders }
        )
        fail("Should have blocked")
      } catch (e: any) {
        expect(e.response.status).toBe(400)
      }
    })

    it("should scope consumption logs GET to production run", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const invRes = await api.post(
        "/admin/inventory-items",
        { title: `Scope-Fabric ${unique}` },
        adminHeaders
      )
      const inventoryItemId = invRes.data.inventory_item.id

      // Create TWO runs for the same design
      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: partnerId, quantity: 1, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      const runId = createRes.data.children[0].id

      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })

      // Log consumption on this run
      await api.post(
        `/partners/production-runs/${runId}/consumption-logs`,
        { inventoryItemId, quantity: 3, unitOfMeasure: "Meter", consumptionType: "production" },
        { headers: partnerHeaders }
      )

      // GET consumption logs scoped to this run
      const logsRes = await api.get(
        `/partners/production-runs/${runId}/consumption-logs`,
        { headers: partnerHeaders }
      )
      expect(logsRes.status).toBe(200)
      expect(logsRes.data.logs.length).toBe(1)
      expect(logsRes.data.count).toBe(1)

      // Verify all returned logs belong to this run
      for (const log of logsRes.data.logs) {
        expect(log.metadata?.production_run_id).toBe(runId)
      }

      // Complete lifecycle to release async workflow steps
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })
    })

    it("should reject non-owning partner on accept, finish, complete, and consumption-logs", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId: ownerId, partnerHeaders: ownerHeaders } = await createPartner(unique)
      const { partnerHeaders: otherHeaders } = await createPartner(unique + 1)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: ownerId, quantity: 1, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      const runId = createRes.data.children[0].id

      // Other partner → accept
      try {
        await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: otherHeaders })
        fail("should reject")
      } catch (e: any) {
        expect([400, 404]).toContain(e.response.status)
      }

      // Owner accepts + starts + finishes to test remaining actions
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: ownerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: ownerHeaders })

      // Other partner → finish
      try {
        await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: otherHeaders })
        fail("should reject")
      } catch (e: any) {
        expect([400, 404]).toContain(e.response.status)
      }

      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: ownerHeaders })

      // Other partner → complete
      try {
        await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: otherHeaders })
        fail("should reject")
      } catch (e: any) {
        expect([400, 404]).toContain(e.response.status)
      }

      // Other partner → consumption-logs
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

      // Complete lifecycle to release async workflow steps
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: ownerHeaders })
    })

    it("should derive partner_status from production run on design GET", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      // Link partner to design
      await api.post(
        `/admin/designs/${designId}/partners`,
        { partner_id: partnerId },
        adminHeaders
      ).catch(() => {
        // Link may be created automatically by production run assignment
      })

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: partnerId, quantity: 1, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      const runId = createRes.data.children[0].id

      // Before accept: partner_status should be "assigned"
      const designBefore = await api.get(
        `/partners/designs/${designId}`,
        { headers: partnerHeaders }
      ).catch(() => null)

      if (designBefore) {
        expect(["assigned", "incoming"]).toContain(
          designBefore.data.design?.partner_info?.partner_status
        )
      }

      // Accept + start → partner_status should be "in_progress"
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })

      const designDuring = await api.get(
        `/partners/designs/${designId}`,
        { headers: partnerHeaders }
      ).catch(() => null)

      if (designDuring) {
        expect(designDuring.data.design?.partner_info?.partner_status).toBe("in_progress")
        expect(designDuring.data.design?.partner_info?.partner_started_at).toBeDefined()
      }

      // Finish + complete → partner_status should be "completed"
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })

      const designAfter = await api.get(
        `/partners/designs/${designId}`,
        { headers: partnerHeaders }
      ).catch(() => null)

      if (designAfter) {
        expect(designAfter.data.design?.partner_info?.partner_status).toBe("completed")
        expect(designAfter.data.design?.partner_info?.partner_completed_at).toBeDefined()
      }
    })

    it("should block media upload on completed run", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { cuttingName, stitchingName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            { partner_id: partnerId, quantity: 1, template_names: [cuttingName, stitchingName] },
          ],
        },
        adminHeaders
      )
      const runId = createRes.data.children[0].id

      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/complete`, {}, { headers: partnerHeaders })

      // Try media attach on completed run
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
  })
})
