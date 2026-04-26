import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const TEST_PARTNER_EMAIL = "partner@consumption-log-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  describe("Design Consumption Logs - Sample Material Tracking", () => {
    const { api, getContainer } = getSharedTestEnv()

    let adminHeaders: any
    let partnerHeaders: any
    let partnerId: string
    let designId: string
    let inventoryItemId: string
    let inventoryItemId2: string
    let stockLocationId: string

    const dbg = (label: string, payload: any) => {
      try {
        console.log(`[TEST DBG] ${label}:`, JSON.stringify(payload, null, 2))
      } catch {
        console.log(`[TEST DBG] ${label}:`, payload)
      }
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Register and login partner
      await api.post("/auth/partner/emailpass/register", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })

      const partnerLoginRes = await api.post("/auth/partner/emailpass", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${partnerLoginRes.data.token}` }

      // Create partner
      const partnerRes: any = await api.post(
        "/partners",
        {
          name: "Consumption Test Partner",
          handle: "consumption-test-partner",
          admin: {
            email: TEST_PARTNER_EMAIL,
            first_name: "Partner",
            last_name: "Admin",
          },
        },
        { headers: partnerHeaders }
      )
      expect(partnerRes.status).toBe(200)
      partnerId = partnerRes.data.partner.id

      // Refresh token after partner creation
      const newAuth: any = await api.post("/auth/partner/emailpass", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${newAuth.data.token}` }

      // Create stock location
      const stockLocRes = await api.post(
        "/admin/stock-locations",
        { name: "Sample Warehouse" },
        adminHeaders
      )
      expect(stockLocRes.status).toBe(200)
      stockLocationId = stockLocRes.data.stock_location.id

      // Create inventory items (raw materials)
      const silkRes = await api.post(
        "/admin/inventory-items",
        { title: "Silk Fabric", description: "Premium silk for sampling" },
        adminHeaders
      )
      expect(silkRes.status).toBe(200)
      inventoryItemId = silkRes.data.inventory_item.id

      const liningRes = await api.post(
        "/admin/inventory-items",
        { title: "Cotton Lining", description: "Cotton lining material" },
        adminHeaders
      )
      expect(liningRes.status).toBe(200)
      inventoryItemId2 = liningRes.data.inventory_item.id

      // Associate inventory items with stock location (initial stock: 100)
      {
        const { result } = await createInventoryLevelsWorkflow(container).run({
          input: {
            inventory_levels: [
              {
                inventory_item_id: inventoryItemId,
                location_id: stockLocationId,
                stocked_quantity: 100,
              },
              {
                inventory_item_id: inventoryItemId2,
                location_id: stockLocationId,
                stocked_quantity: 50,
              },
            ],
          },
        })
        dbg("inventory_levels_created", result)
      }

      // Create a design in Sample_Production status
      const designRes: any = await api.post(
        "/admin/designs",
        {
          name: "Consumption Log Test Design",
          description: "Design for testing sample consumption tracking",
          design_type: "Original",
          status: "Sample_Production",
          priority: "High",
          target_completion_date: new Date().toISOString(),
          tags: ["test", "sampling"],
          metadata: { purpose: "consumption-log-test" },
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      designId = designRes.data.design.id

      // Link inventory items to the design
      const linkRes = await api.post(
        `/admin/designs/${designId}/inventory`,
        {
          inventoryItems: [
            {
              inventoryId: inventoryItemId,
              plannedQuantity: 20,
              locationId: stockLocationId,
            },
            {
              inventoryId: inventoryItemId2,
              plannedQuantity: 10,
              locationId: stockLocationId,
            },
          ],
        },
        adminHeaders
      )
      expect(linkRes.status).toBe(201)
    })

    // ─── Admin Consumption Log CRUD ─────────────────────────────────

    describe("POST /admin/designs/:id/consumption-logs", () => {
      it("should log a sample consumption entry", async () => {
        const res = await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          {
            inventoryItemId,
            quantity: 2.5,
            unitOfMeasure: "Meter",
            consumptionType: "sample",
            notes: "Used for initial prototype stitching",
            locationId: stockLocationId,
          },
          adminHeaders
        )

        expect(res.status).toBe(201)
        expect(res.data.consumption_log).toBeDefined()

        const log = res.data.consumption_log
        expect(log.id).toBeDefined()
        expect(log.design_id).toBe(designId)
        expect(log.inventory_item_id).toBe(inventoryItemId)
        expect(log.quantity).toBe(2.5)
        expect(log.unit_of_measure).toBe("Meter")
        expect(log.consumption_type).toBe("sample")
        expect(log.is_committed).toBe(false)
        expect(log.consumed_by).toBe("admin")
        expect(log.notes).toBe("Used for initial prototype stitching")
        expect(log.consumed_at).toBeDefined()
        dbg("admin.log.created", log)
      })

      it("should log wastage consumption", async () => {
        const res = await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          {
            inventoryItemId: inventoryItemId2,
            quantity: 0.5,
            unitOfMeasure: "Meter",
            consumptionType: "wastage",
            notes: "Cutting wastage",
          },
          adminHeaders
        )

        expect(res.status).toBe(201)
        expect(res.data.consumption_log.consumption_type).toBe("wastage")
        expect(res.data.consumption_log.is_committed).toBe(false)
      })
    })

    describe("GET /admin/designs/:id/consumption-logs", () => {
      it("should list all consumption logs for a design", async () => {
        // Create two log entries
        await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          { inventoryItemId, quantity: 3, consumptionType: "sample" },
          adminHeaders
        )
        await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          { inventoryItemId: inventoryItemId2, quantity: 1, consumptionType: "sample" },
          adminHeaders
        )

        const res = await api.get(
          `/admin/designs/${designId}/consumption-logs`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.logs).toBeDefined()
        expect(res.data.logs.length).toBe(2)
        expect(res.data.count).toBe(2)
      })

      it("should filter logs by consumption_type", async () => {
        await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          { inventoryItemId, quantity: 2, consumptionType: "sample" },
          adminHeaders
        )
        await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          { inventoryItemId: inventoryItemId2, quantity: 0.3, consumptionType: "wastage" },
          adminHeaders
        )

        const res = await api.get(
          `/admin/designs/${designId}/consumption-logs?consumption_type=wastage`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.logs.length).toBe(1)
        expect(res.data.logs[0].consumption_type).toBe("wastage")
      })

      it("should filter logs by is_committed", async () => {
        await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          { inventoryItemId, quantity: 5, consumptionType: "sample" },
          adminHeaders
        )

        const res = await api.get(
          `/admin/designs/${designId}/consumption-logs?is_committed=false`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.logs.length).toBe(1)
        expect(res.data.logs[0].is_committed).toBe(false)
      })

      it("should return empty when design has no logs", async () => {
        // Create a fresh design with no consumption
        const freshDesign: any = await api.post(
          "/admin/designs",
          {
            name: "Empty Design",
            description: "No consumption logs",
            design_type: "Original",
            status: "Conceptual",
            priority: "Low",
          },
          adminHeaders
        )

        const res = await api.get(
          `/admin/designs/${freshDesign.data.design.id}/consumption-logs`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.logs).toHaveLength(0)
        expect(res.data.count).toBe(0)
      })
    })

    // ─── Commit Workflow ─────────────────────────────────────────────

    describe("POST /admin/designs/:id/consumption-logs/commit", () => {
      it("should commit specific logs and mark them committed (no inventory adjustment)", async () => {
        // Log two sample consumptions
        const log1Res = await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          {
            inventoryItemId,
            quantity: 5,
            unitOfMeasure: "Meter",
            consumptionType: "sample",
            locationId: stockLocationId,
          },
          adminHeaders
        )
        const log1Id = log1Res.data.consumption_log.id

        const log2Res = await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          {
            inventoryItemId: inventoryItemId2,
            quantity: 2,
            unitOfMeasure: "Meter",
            consumptionType: "sample",
            locationId: stockLocationId,
          },
          adminHeaders
        )
        const log2Id = log2Res.data.consumption_log.id

        // Commit only log1
        const commitRes = await api.post(
          `/admin/designs/${designId}/consumption-logs/commit`,
          { logIds: [log1Id] },
          adminHeaders
        )

        expect(commitRes.status).toBe(200)
        dbg("commitRes", commitRes.data)

        // Verify log1 is committed, log2 is not
        const logsRes = await api.get(
          `/admin/designs/${designId}/consumption-logs`,
          adminHeaders
        )
        const committedLog = logsRes.data.logs.find((l: any) => l.id === log1Id)
        const uncommittedLog = logsRes.data.logs.find((l: any) => l.id === log2Id)

        expect(committedLog.is_committed).toBe(true)
        expect(uncommittedLog.is_committed).toBe(false)

        // Verify inventory is UNTOUCHED (partners don't maintain stock levels)
        const container = getContainer()
        const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: levels } = await query.graph({
          entity: "inventory_level",
          fields: ["inventory_item_id", "location_id", "stocked_quantity"],
          filters: { inventory_item_id: inventoryItemId, location_id: stockLocationId },
        })
        dbg("inventory_levels_after_commit", levels)
        const level = levels[0]
        expect(Number(level.stocked_quantity)).toBe(100)
      })

      it("should commit all uncommitted logs with commitAll (no inventory adjustment)", async () => {
        // Create multiple logs
        await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          { inventoryItemId, quantity: 3, locationId: stockLocationId },
          adminHeaders
        )
        await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          { inventoryItemId: inventoryItemId2, quantity: 2, locationId: stockLocationId },
          adminHeaders
        )

        // Commit all
        const commitRes = await api.post(
          `/admin/designs/${designId}/consumption-logs/commit`,
          { commitAll: true },
          adminHeaders
        )

        expect(commitRes.status).toBe(200)

        // Verify all logs are committed
        const logsRes = await api.get(
          `/admin/designs/${designId}/consumption-logs?is_committed=false`,
          adminHeaders
        )
        expect(logsRes.data.logs).toHaveLength(0)

        // Verify inventory is UNTOUCHED (no adjustment on commit)
        const container = getContainer()
        const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

        const { data: silkLevels } = await query.graph({
          entity: "inventory_level",
          fields: ["stocked_quantity"],
          filters: { inventory_item_id: inventoryItemId, location_id: stockLocationId },
        })
        expect(Number(silkLevels[0].stocked_quantity)).toBe(100)

        const { data: liningLevels } = await query.graph({
          entity: "inventory_level",
          fields: ["stocked_quantity"],
          filters: { inventory_item_id: inventoryItemId2, location_id: stockLocationId },
        })
        expect(Number(liningLevels[0].stocked_quantity)).toBe(50)
      })

      it("should fail when no uncommitted logs exist", async () => {
        const res = await api
          .post(
            `/admin/designs/${designId}/consumption-logs/commit`,
            { commitAll: true },
            adminHeaders
          )
          .catch((err: any) => err.response)

        expect(res.status).toBe(404)
      })
    })

    // ─── Partner Consumption Logging ─────────────────────────────────

    describe("Partner consumption log routes", () => {
      // Task template setup + send-to-partner + start in beforeEach
      // (matches the pattern in designs-partner-workflow.spec.ts)
      beforeEach(async () => {
        const templateNames = [
          "partner-design-start",
          "partner-design-redo",
          "partner-design-finish",
          "partner-design-completed",
          "partner-design-redo-log",
          "partner-design-redo-apply",
          "partner-design-redo-verify",
        ]

        const firstRes: any = await api.post(
          "/admin/task-templates",
          {
            name: templateNames[0],
            description: `Template for ${templateNames[0]}`,
            priority: "medium",
            estimated_duration: 30,
            required_fields: {
              design_id: { type: "string", required: true },
              partner_id: { type: "string", required: true },
            },
            eventable: true,
            notifiable: true,
            message_template: `Task ${templateNames[0]}`,
            metadata: { workflow_type: "partner_design_assignment" },
            category: "Partner Designs",
          },
          adminHeaders
        )
        expect(firstRes.status).toBe(201)
        const categoryId = firstRes.data.task_template.category_id

        for (const name of templateNames.slice(1)) {
          const res = await api.post(
            "/admin/task-templates",
            {
              name,
              description: `Template for ${name}`,
              priority: "medium",
              estimated_duration: 30,
              required_fields: {
                design_id: { type: "string", required: true },
                partner_id: { type: "string", required: true },
              },
              eventable: false,
              notifiable: false,
              message_template: `Task ${name}`,
              metadata: { workflow_type: "partner_design_assignment" },
              category_id: categoryId,
            },
            adminHeaders
          )
          expect(res.status).toBe(201)
        }

        // Send design to partner (workflow pauses at await-design-start)
        const sendRes: any = await api.post(
          `/admin/designs/${designId}/send-to-partner`,
          { partnerId, notes: "Start sampling work" },
          adminHeaders
        )
        expect(sendRes.status).toBe(200)

        // Verify tasks are linked (implicit wait for workflow to settle)
        const taskSummary: any = await api.get(`/admin/designs/${designId}/tasks`, adminHeaders)
        dbg("partner.beforeEach.tasks", (taskSummary.data?.tasks || []).map((t: any) => ({ id: t?.id, title: t?.title, status: t?.status })))

        // Partner starts the design (signals await-design-start)
        const startRes = await api.post(
          `/partners/designs/${designId}/start`,
          {},
          { headers: partnerHeaders }
        )
        expect(startRes.status).toBe(200)
      })

      afterEach(async () => {
        // Complete the partner workflow lifecycle so the long-running workflow resolves
        // finish → signals await-design-finish
        try {
          await api.post(`/partners/designs/${designId}/finish`, {}, { headers: partnerHeaders })
        } catch (e: any) {
          dbg("afterEach.finish.error", e?.message)
        }
        // complete → signals await-design-inventory, fails redo/refinish, signals await-design-completed
        try {
          await api.post(`/partners/designs/${designId}/complete`, { consumptions: [] }, { headers: partnerHeaders })
        } catch (e: any) {
          dbg("afterEach.complete.error", e?.message)
        }
      })

      it("should allow partner to log sample consumption during Sample_Production", async () => {
        const res = await api.post(
          `/partners/designs/${designId}/consumption-logs`,
          {
            inventoryItemId,
            quantity: 2,
            unitOfMeasure: "Meter",
            consumptionType: "sample",
            notes: "Partner used silk for sample stitching",
            locationId: stockLocationId,
          },
          { headers: partnerHeaders }
        )

        expect(res.status).toBe(201)
        expect(res.data.consumption_log).toBeDefined()

        const log = res.data.consumption_log
        expect(log.consumed_by).toBe("partner")
        expect(log.quantity).toBe(2)
        expect(log.is_committed).toBe(false)
        dbg("partner.log.created", log)
      })

      it("should allow partner to list their consumption logs", async () => {
        // Partner logs two entries
        await api.post(
          `/partners/designs/${designId}/consumption-logs`,
          { inventoryItemId, quantity: 1.5, consumptionType: "sample", locationId: stockLocationId },
          { headers: partnerHeaders }
        )
        await api.post(
          `/partners/designs/${designId}/consumption-logs`,
          { inventoryItemId: inventoryItemId2, quantity: 0.5, consumptionType: "wastage", locationId: stockLocationId },
          { headers: partnerHeaders }
        )

        const res = await api.get(
          `/partners/designs/${designId}/consumption-logs`,
          { headers: partnerHeaders }
        )

        expect(res.status).toBe(200)
        expect(res.data.logs.length).toBe(2)
        expect(res.data.count).toBe(2)
        dbg("partner.logs.list", res.data.logs)
      })

      it("should allow admin to commit partner-logged consumption (no inventory adjustment)", async () => {
        // Partner logs consumption
        const logRes = await api.post(
          `/partners/designs/${designId}/consumption-logs`,
          { inventoryItemId, quantity: 4, consumptionType: "sample", locationId: stockLocationId },
          { headers: partnerHeaders }
        )
        expect(logRes.status).toBe(201)
        const logId = logRes.data.consumption_log.id

        // Admin commits it
        const commitRes = await api.post(
          `/admin/designs/${designId}/consumption-logs/commit`,
          { logIds: [logId] },
          adminHeaders
        )
        expect(commitRes.status).toBe(200)

        // Verify committed
        const logsRes = await api.get(
          `/admin/designs/${designId}/consumption-logs?is_committed=true`,
          adminHeaders
        )
        expect(logsRes.data.logs.length).toBe(1)
        expect(logsRes.data.logs[0].id).toBe(logId)
        expect(logsRes.data.logs[0].is_committed).toBe(true)

        // Verify inventory is UNTOUCHED (partners don't maintain stock levels)
        const container = getContainer()
        const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: levels } = await query.graph({
          entity: "inventory_level",
          fields: ["stocked_quantity"],
          filters: { inventory_item_id: inventoryItemId, location_id: stockLocationId },
        })
        expect(Number(levels[0].stocked_quantity)).toBe(100)
      })
    })

    // ─── End-to-End Sampling Scenario ────────────────────────────────

    describe("E2E: Sample development → incremental logging → review → commit", () => {
      beforeEach(async () => {
        const templateNames = [
          "partner-design-start",
          "partner-design-redo",
          "partner-design-finish",
          "partner-design-completed",
          "partner-design-redo-log",
          "partner-design-redo-apply",
          "partner-design-redo-verify",
        ]

        const firstRes: any = await api.post(
          "/admin/task-templates",
          {
            name: templateNames[0],
            description: `Template for ${templateNames[0]}`,
            priority: "medium",
            estimated_duration: 30,
            required_fields: {
              design_id: { type: "string", required: true },
              partner_id: { type: "string", required: true },
            },
            eventable: true,
            notifiable: true,
            message_template: `Task ${templateNames[0]}`,
            metadata: { workflow_type: "partner_design_assignment" },
            category: "Partner Designs",
          },
          adminHeaders
        )
        const categoryId = firstRes.data.task_template.category_id

        for (const name of templateNames.slice(1)) {
          await api.post(
            "/admin/task-templates",
            {
              name,
              description: `Template for ${name}`,
              priority: "medium",
              estimated_duration: 30,
              required_fields: {
                design_id: { type: "string", required: true },
                partner_id: { type: "string", required: true },
              },
              eventable: false,
              notifiable: false,
              message_template: `Task ${name}`,
              metadata: { workflow_type: "partner_design_assignment" },
              category_id: categoryId,
            },
            adminHeaders
          )
        }

        // Send to partner (workflow pauses at await-design-start)
        const sendRes: any = await api.post(
          `/admin/designs/${designId}/send-to-partner`,
          { partnerId, notes: "E2E sampling test" },
          adminHeaders
        )
        expect(sendRes.status).toBe(200)

        // Verify tasks are linked (implicit wait for workflow to settle)
        const taskSummary: any = await api.get(`/admin/designs/${designId}/tasks`, adminHeaders)
        dbg("e2e.beforeEach.tasks", (taskSummary.data?.tasks || []).map((t: any) => ({ title: t?.title, status: t?.status })))

        // Partner starts (signals await-design-start)
        const startRes = await api.post(
          `/partners/designs/${designId}/start`,
          {},
          { headers: partnerHeaders }
        )
        expect(startRes.status).toBe(200)
      })

      afterEach(async () => {
        // Complete partner workflow lifecycle to release long-running workflow
        try {
          await api.post(`/partners/designs/${designId}/finish`, {}, { headers: partnerHeaders })
        } catch (e: any) {
          dbg("e2e.afterEach.finish.error", e?.message)
        }
        try {
          await api.post(`/partners/designs/${designId}/complete`, { consumptions: [] }, { headers: partnerHeaders })
        } catch (e: any) {
          dbg("e2e.afterEach.complete.error", e?.message)
        }
      })

      it("should track sample consumption incrementally and commit without adjusting inventory", async () => {
        const container = getContainer()
        const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

        // ── Step 1: Partner logs consumption over several days of sampling ──

        // Day 1: Partner uses 3m of silk
        const log1Res = await api.post(
          `/partners/designs/${designId}/consumption-logs`,
          {
            inventoryItemId,
            quantity: 3,
            unitOfMeasure: "Meter",
            consumptionType: "sample",
            notes: "Day 1: Initial pattern cutting",
            locationId: stockLocationId,
          },
          { headers: partnerHeaders }
        )
        expect(log1Res.status).toBe(201)

        // Day 2: Partner uses 1.5m of lining
        const log2Res = await api.post(
          `/partners/designs/${designId}/consumption-logs`,
          {
            inventoryItemId: inventoryItemId2,
            quantity: 1.5,
            unitOfMeasure: "Meter",
            consumptionType: "sample",
            notes: "Day 2: Lining for prototype",
            locationId: stockLocationId,
          },
          { headers: partnerHeaders }
        )
        expect(log2Res.status).toBe(201)

        // Day 3: Some wastage during silk cutting
        const log3Res = await api.post(
          `/partners/designs/${designId}/consumption-logs`,
          {
            inventoryItemId,
            quantity: 0.5,
            unitOfMeasure: "Meter",
            consumptionType: "wastage",
            notes: "Day 3: Cutting waste",
            locationId: stockLocationId,
          },
          { headers: partnerHeaders }
        )
        expect(log3Res.status).toBe(201)

        // ── Step 2: Verify inventory is UNTOUCHED (no commit yet) ──

        const { data: silkLevelsBefore } = await query.graph({
          entity: "inventory_level",
          fields: ["stocked_quantity"],
          filters: { inventory_item_id: inventoryItemId, location_id: stockLocationId },
        })
        expect(Number(silkLevelsBefore[0].stocked_quantity)).toBe(100)

        const { data: liningLevelsBefore } = await query.graph({
          entity: "inventory_level",
          fields: ["stocked_quantity"],
          filters: { inventory_item_id: inventoryItemId2, location_id: stockLocationId },
        })
        expect(Number(liningLevelsBefore[0].stocked_quantity)).toBe(50)

        dbg("inventory.before_commit", {
          silk: Number(silkLevelsBefore[0].stocked_quantity),
          lining: Number(liningLevelsBefore[0].stocked_quantity),
        })

        // ── Step 3: Admin reviews all consumption logs ──

        const reviewRes = await api.get(
          `/admin/designs/${designId}/consumption-logs`,
          adminHeaders
        )
        expect(reviewRes.status).toBe(200)
        expect(reviewRes.data.logs.length).toBe(3)
        expect(reviewRes.data.count).toBe(3)

        // All should be uncommitted
        const allUncommitted = reviewRes.data.logs.every((l: any) => l.is_committed === false)
        expect(allUncommitted).toBe(true)

        // Verify filtering by consumed_by=partner
        const partnerOnlyRes = await api.get(
          `/admin/designs/${designId}/consumption-logs?consumed_by=partner`,
          adminHeaders
        )
        expect(partnerOnlyRes.data.logs.length).toBe(3)

        // Admin also logs some consumption
        const adminLogRes = await api.post(
          `/admin/designs/${designId}/consumption-logs`,
          {
            inventoryItemId,
            quantity: 1,
            unitOfMeasure: "Meter",
            consumptionType: "sample",
            notes: "Admin QC sample",
            locationId: stockLocationId,
          },
          adminHeaders
        )
        expect(adminLogRes.status).toBe(201)
        expect(adminLogRes.data.consumption_log.consumed_by).toBe("admin")

        // Total logs should now be 4
        const allLogsRes = await api.get(
          `/admin/designs/${designId}/consumption-logs`,
          adminHeaders
        )
        expect(allLogsRes.data.count).toBe(4)

        // ── Step 4: Admin decides to purchase → commit all logs ──

        const commitRes = await api.post(
          `/admin/designs/${designId}/consumption-logs/commit`,
          { commitAll: true, defaultLocationId: stockLocationId },
          adminHeaders
        )
        expect(commitRes.status).toBe(200)
        dbg("commit.result", commitRes.data)

        // ── Step 5: Verify all logs are now committed ──

        const afterCommitRes = await api.get(
          `/admin/designs/${designId}/consumption-logs?is_committed=false`,
          adminHeaders
        )
        expect(afterCommitRes.data.logs).toHaveLength(0)

        const committedRes = await api.get(
          `/admin/designs/${designId}/consumption-logs?is_committed=true`,
          adminHeaders
        )
        expect(committedRes.data.logs.length).toBe(4)

        // ── Step 6: Verify inventory is UNTOUCHED after commit ──
        // Partners don't maintain stock levels — commit only records data

        const { data: silkLevelsAfter } = await query.graph({
          entity: "inventory_level",
          fields: ["stocked_quantity"],
          filters: { inventory_item_id: inventoryItemId, location_id: stockLocationId },
        })
        expect(Number(silkLevelsAfter[0].stocked_quantity)).toBe(100)

        const { data: liningLevelsAfter } = await query.graph({
          entity: "inventory_level",
          fields: ["stocked_quantity"],
          filters: { inventory_item_id: inventoryItemId2, location_id: stockLocationId },
        })
        expect(Number(liningLevelsAfter[0].stocked_quantity)).toBe(50)

        dbg("inventory.after_commit", {
          silk: Number(silkLevelsAfter[0].stocked_quantity),
          lining: Number(liningLevelsAfter[0].stocked_quantity),
        })

        console.log("\n✅ E2E sample consumption tracking completed successfully!")
      })
    })
  })
})
