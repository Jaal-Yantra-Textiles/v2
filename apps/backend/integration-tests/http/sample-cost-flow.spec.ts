import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("Sample Production Run → Cost Estimation Flow", () => {

    async function setup() {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now()

      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      try {
        await api.post("/admin/email-templates", {
          name: "Admin Partner Created",
          template_key: "partner-created-from-admin",
          subject: "Partner account at {{partner_name}}",
          html_content: "<div>Partner {{partner_name}} created.</div>",
          from: "partners@jaalyantra.com",
          variables: { partner_name: "name", temp_password: "pwd" },
          template_type: "email",
        }, adminHeaders)
      } catch { /* ok */ }

      return { api, container, adminHeaders, unique }
    }

    async function createPartner(api: any, unique: number) {
      const email = `cost-partner-${unique}@jyt.test`
      const pw = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password: pw })
      let lr = await api.post("/auth/partner/emailpass", { email, password: pw })
      let h = { Authorization: `Bearer ${lr.data.token}` }

      const res = await api.post("/partners", {
        name: `Cost Partner ${unique}`,
        handle: `cost-partner-${unique}`,
        admin: { email, first_name: "T", last_name: "P" },
      }, { headers: h })
      expect(res.status).toBe(200)

      lr = await api.post("/auth/partner/emailpass", { email, password: pw })
      h = { Authorization: `Bearer ${lr.data.token}` }
      return { partnerId: res.data.partner.id, partnerHeaders: h }
    }

    async function createDesignWithInventory(
      api: any,
      adminHeaders: any,
      container: any,
      unique: number
    ) {
      // Create design
      const designRes = await api.post("/admin/designs", {
        name: `Cost Flow Design ${unique}`,
        description: "For cost flow test",
        design_type: "Original",
        status: "Approved",
        priority: "Medium",
      }, adminHeaders)
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      // Create inventory item
      const invRes = await api.post("/admin/inventory-items", {
        title: `Silk Fabric ${unique}`,
        sku: `SILK-${unique}`,
      }, adminHeaders)
      expect(invRes.status).toBe(200)
      const itemId = invRes.data.inventory_item.id

      // Create stock location + inventory level so commits can deduct
      const locRes = await api.post("/admin/stock-locations", {
        name: `Warehouse ${unique}`,
      }, adminHeaders)
      expect(locRes.status).toBe(200)
      const locationId = locRes.data.stock_location.id

      const inventoryService = container.resolve(Modules.INVENTORY) as any
      await inventoryService.createInventoryLevels({
        inventory_item_id: itemId,
        location_id: locationId,
        stocked_quantity: 100,
      })

      // Create raw material with unit_cost
      const rawMaterialService = container.resolve("raw_materials") as any
      let rawMaterial: any
      try {
        rawMaterial = await rawMaterialService.createRawMaterials({
          name: `Silk ${unique}`,
          description: "Premium silk fabric",
          composition: "100% Silk",
          unit_cost: 500,
          cost_currency: "inr",
        })
      } catch (e: any) {
        console.log("[DEBUG] raw material create failed:", e.message)
        throw e
      }

      // Link inventory item → raw material + design
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      try {
        await remoteLink.create({
          [Modules.INVENTORY]: { inventory_item_id: itemId },
          raw_materials: { raw_materials_id: rawMaterial.id },
        })
      } catch (e: any) {
        console.log("[DEBUG] inv→raw_mat link failed:", e.message)
        throw e
      }

      try {
        await remoteLink.create({
          design: { design_id: designId },
          [Modules.INVENTORY]: { inventory_item_id: itemId },
        })
      } catch (e: any) {
        console.log("[DEBUG] design→inv link failed:", e.message)
        throw e
      }

      return { designId, itemId, locationId, rawMaterialId: rawMaterial.id }
    }

    it("full flow: create sample run → log consumption with cost → complete → design cost updated", async () => {
      const { api, container, adminHeaders, unique } = await setup()
      const { partnerId, partnerHeaders } = await createPartner(api, unique)
      const { designId, itemId, locationId } = await createDesignWithInventory(api, adminHeaders, container, unique)

      // Link partner to design
      const linkRes = await api.post(`/admin/designs/${designId}/partner`, {
        partnerIds: [partnerId],
      }, { ...adminHeaders, validateStatus: () => true })
      if (linkRes.status !== 201) {
        console.log("[DEBUG] partner link failed:", linkRes.status, JSON.stringify(linkRes.data).slice(0, 300))
      }
      expect(linkRes.status).toBe(201)

      // Create sample production run (no dispatch — avoid async hang)
      const runRes = await api.post("/admin/production-runs", {
        design_id: designId,
        partner_id: partnerId,
        quantity: 1,
        run_type: "sample",
      }, { ...adminHeaders, validateStatus: () => true })
      if (runRes.status !== 201) {
        console.log("[DEBUG] run create:", runRes.status, JSON.stringify(runRes.data).slice(0, 500))
      }
      expect(runRes.status).toBe(201)
      const runId = runRes.data.production_run.id
      expect(runRes.data.production_run.run_type).toBe("sample")

      // Simulate in_progress
      const runService = container.resolve("production_runs") as any
      await runService.updateProductionRuns({
        id: runId,
        status: "in_progress",
        accepted_at: new Date(),
        started_at: new Date(),
      })

      // Log consumption with unit_cost from partner
      const logRes = await api.post(
        `/partners/production-runs/${runId}/consumption-logs`,
        {
          inventoryItemId: itemId,
          quantity: 2.5,
          unitCost: 800,
          unitOfMeasure: "Meter",
          consumptionType: "sample",
          notes: "Silk for sample garment",
          locationId: locationId,
        },
        { headers: partnerHeaders, validateStatus: () => true }
      )
      if (logRes.status !== 201) {
        console.log("[DEBUG] consumption log:", logRes.status, JSON.stringify(logRes.data).slice(0, 500))
      }
      expect(logRes.status).toBe(201)
      expect(logRes.data.consumption_log).toBeDefined()

      // Verify the log has unit_cost stored
      const consumptionLogService = container.resolve("consumption_log") as any
      const [logs] = await consumptionLogService.listAndCountConsumptionLogs(
        { design_id: designId },
        { take: 10 }
      )
      expect(logs.length).toBe(1)
      expect(logs[0].unit_cost).toBe(800)
      expect(logs[0].quantity).toBe(2.5)

      // Admin commits the consumption log
      const commitRes = await api.post(
        `/admin/designs/${designId}/consumption-logs/commit`,
        { logIds: [logs[0].id] },
        { ...adminHeaders, validateStatus: () => true }
      )
      if (commitRes.status !== 200) {
        console.log("[DEBUG] commit:", commitRes.status, JSON.stringify(commitRes.data).slice(0, 500))
      }
      expect(commitRes.status).toBe(200)

      // Verify committed
      const [committedLogs] = await consumptionLogService.listAndCountConsumptionLogs(
        { design_id: designId, is_committed: true },
        { take: 10 }
      )
      expect(committedLogs.length).toBe(1)

      // Simulate run completion + finish
      await runService.updateProductionRuns({
        id: runId,
        finished_at: new Date(),
      })

      // Complete the run (triggers production_run.completed event → subscriber)
      await runService.updateProductionRuns({
        id: runId,
        status: "completed",
        completed_at: new Date(),
      })

      // Manually trigger the subscriber logic since events may not fire in test
      const sampleRunCompleted = (await import("../../src/subscribers/sample-run-completed")).default
      await sampleRunCompleted({
        event: { data: { id: runId } },
        container,
      } as any)

      // Verify design cost was updated
      const designService = container.resolve("design") as any
      const updatedDesign = await designService.retrieveDesign(designId)

      // Material cost = 2.5 × 800 = 2000
      // Production cost = 2000 × 0.30 = 600
      // Total = 2600
      expect(Number(updatedDesign.material_cost)).toBe(2000)
      expect(Number(updatedDesign.production_cost)).toBe(600)
      expect(Number(updatedDesign.estimated_cost)).toBe(2600)

      // Verify cost_breakdown is on a proper column, not metadata
      expect(updatedDesign.cost_breakdown).toBeDefined()
      expect(updatedDesign.cost_breakdown.items).toHaveLength(1)
      expect(updatedDesign.cost_breakdown.items[0].unit_cost).toBe(800)
      expect(updatedDesign.cost_breakdown.items[0].cost_source).toBe("partner_input")
      expect(updatedDesign.cost_breakdown.source).toBe("sample_consumption")
    })

    it("should fall back to raw_material unit_cost when partner doesn't provide cost", async () => {
      const { api, container, adminHeaders, unique } = await setup()
      const { partnerId, partnerHeaders } = await createPartner(api, unique)
      const { designId, itemId, locationId } = await createDesignWithInventory(api, adminHeaders, container, unique)

      // Link partner
      await api.post(`/admin/designs/${designId}/partner`, {
        partnerIds: [partnerId],
      }, adminHeaders)

      // Create + start run
      const runRes = await api.post("/admin/production-runs", {
        design_id: designId,
        partner_id: partnerId,
        quantity: 1,
        run_type: "sample",
      }, adminHeaders)
      const runId = runRes.data.production_run.id

      const runService = container.resolve("production_runs") as any
      await runService.updateProductionRuns({
        id: runId,
        status: "in_progress",
        accepted_at: new Date(),
        started_at: new Date(),
      })

      // Log consumption WITHOUT unit_cost
      await api.post(
        `/partners/production-runs/${runId}/consumption-logs`,
        {
          inventoryItemId: itemId,
          quantity: 3,
          unitOfMeasure: "Meter",
          consumptionType: "sample",
          locationId: locationId,
        },
        { headers: partnerHeaders }
      )

      // Commit
      const consumptionLogService = container.resolve("consumption_log") as any
      const [logs] = await consumptionLogService.listAndCountConsumptionLogs(
        { design_id: designId },
        { take: 10 }
      )
      await api.post(
        `/admin/designs/${designId}/consumption-logs/commit`,
        { logIds: [logs[0].id] },
        adminHeaders
      )

      // Complete + trigger subscriber
      await runService.updateProductionRuns({
        id: runId,
        finished_at: new Date(),
        status: "completed",
        completed_at: new Date(),
      })

      const sampleRunCompleted = (await import("../../src/subscribers/sample-run-completed")).default
      await sampleRunCompleted({
        event: { data: { id: runId } },
        container,
      } as any)

      // Verify: falls back to inventory unit_cost (500)
      const designService = container.resolve("design") as any
      const design = await designService.retrieveDesign(designId)

      // Material = 3 × 500 = 1500, production = 450, total = 1950
      expect(Number(design.material_cost)).toBe(1500)
      expect(Number(design.production_cost)).toBe(450)
      expect(Number(design.estimated_cost)).toBe(1950)
      expect(design.cost_breakdown.items[0].cost_source).toBe("raw_material")
    })
  })
})
