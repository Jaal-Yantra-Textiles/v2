import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { createTestCustomer } from "../helpers/create-customer"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

jest.setTimeout(90000)

setupSharedTestSuite(() => {
  describe("E2E: Consumption cost propagation → Design estimate → Draft order", () => {
    const { api, getContainer } = getSharedTestEnv()

    let adminHeaders: any
    let customerId: string
    let designId: string
    let inventoryItemId: string
    let inventoryItemId2: string
    let stockLocationId: string
    let rawMaterialId: string

    const dbg = (label: string, payload: any) => {
      try {
        console.log(`[COST-PROP TEST] ${label}:`, JSON.stringify(payload, null, 2))
      } catch {
        console.log(`[COST-PROP TEST] ${label}:`, payload)
      }
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Create a region with INR currency (needed for draft order cart creation)
      const regionService: IRegionModuleService = container.resolve(Modules.REGION)
      await regionService.createRegions({
        name: "India",
        currency_code: "inr",
        countries: ["in"],
      })

      // Create a customer for draft order flow
      const { customer } = await createTestCustomer(container)
      customerId = customer.id

      // Create stock location
      const stockLocRes = await api.post(
        "/admin/stock-locations",
        { name: "Test Warehouse" },
        adminHeaders
      )
      expect(stockLocRes.status).toBe(200)
      stockLocationId = stockLocRes.data.stock_location.id

      // Create inventory items
      const silkRes = await api.post(
        "/admin/inventory-items",
        { title: "Silk Fabric", description: "Premium silk" },
        adminHeaders
      )
      expect(silkRes.status).toBe(200)
      inventoryItemId = silkRes.data.inventory_item.id

      const liningRes = await api.post(
        "/admin/inventory-items",
        { title: "Cotton Lining", description: "Cotton lining" },
        adminHeaders
      )
      expect(liningRes.status).toBe(200)
      inventoryItemId2 = liningRes.data.inventory_item.id

      // Create inventory levels
      await createInventoryLevelsWorkflow(container).run({
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

      // Create a raw material and link it to inventory item 1
      try {
        const rmRes = await api.post(
          "/admin/raw-materials",
          {
            name: "Premium Silk",
            description: "High quality silk",
            composition: "100% Silk",
            unit_of_measure: "Meter",
            status: "Active",
          },
          adminHeaders
        )
        if (rmRes.status === 201 || rmRes.status === 200) {
          rawMaterialId = rmRes.data.raw_material?.id || rmRes.data.rawMaterial?.id
          // Link raw material to inventory item
          if (rawMaterialId) {
            await api.post(
              `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
              { rawMaterialId },
              adminHeaders
            ).catch(() => {
              // Non-fatal
            })
          }
        }
      } catch {
        // Raw material creation may not be available — test still works without it
        dbg("raw_material_setup", "skipped (endpoint not available)")
      }

      // Create a design
      const designRes: any = await api.post(
        "/admin/designs",
        {
          name: "Cost Propagation Test Design",
          description: "Design for testing cost propagation from consumption logs",
          design_type: "Original",
          status: "Sample_Production",
          priority: "High",
          target_completion_date: new Date().toISOString(),
          tags: ["test", "cost-propagation"],
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
              plannedQuantity: 10,
              locationId: stockLocationId,
            },
            {
              inventoryId: inventoryItemId2,
              plannedQuantity: 5,
              locationId: stockLocationId,
            },
          ],
        },
        adminHeaders
      )
      expect(linkRes.status).toBe(201)

      // Link design to customer (needed for draft order)
      const linkCustomerRes = await api.post(
        `/admin/customers/${customerId}/designs`,
        { design_ids: [designId] },
        adminHeaders
      )
      expect(linkCustomerRes.status).toBe(200)
    })

    // ─── Core test: consumption commit propagates costs to estimate ───

    it("should propagate unit_cost from consumption logs to raw materials on commit", async () => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const rawMaterialService = container.resolve("raw_materials") as any

      // ── Step 1: Create raw materials and link them to inventory items ──
      const silkRm = await rawMaterialService.createRawMaterials({
        name: "Test Silk",
        description: "Silk for propagation test",
        composition: "100% Silk",
        unit_of_measure: "Meter",
        status: "Active",
      })
      const liningRm = await rawMaterialService.createRawMaterials({
        name: "Test Lining",
        description: "Lining for propagation test",
        composition: "100% Cotton",
        unit_of_measure: "Meter",
        status: "Active",
      })

      // Link raw materials to inventory items
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create([
        {
          [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
          raw_materials: { raw_materials_id: silkRm.id },
        },
        {
          [Modules.INVENTORY]: { inventory_item_id: inventoryItemId2 },
          raw_materials: { raw_materials_id: liningRm.id },
        },
      ])

      // Verify raw materials have no unit_cost initially
      const silkBefore = await rawMaterialService.retrieveRawMaterial(silkRm.id)
      expect(silkBefore.unit_cost).toBeFalsy()

      // ── Step 2: Log consumption with unit_cost ──
      const log1Res = await api.post(
        `/admin/designs/${designId}/consumption-logs`,
        {
          inventoryItemId,
          quantity: 5,
          unitCost: 150.50,
          unitOfMeasure: "Meter",
          consumptionType: "sample",
          notes: "Silk used for prototype",
          locationId: stockLocationId,
        },
        adminHeaders
      )
      expect(log1Res.status).toBe(201)

      const log2Res = await api.post(
        `/admin/designs/${designId}/consumption-logs`,
        {
          inventoryItemId: inventoryItemId2,
          quantity: 2,
          unitCost: 80,
          unitOfMeasure: "Meter",
          consumptionType: "sample",
          notes: "Lining for prototype",
          locationId: stockLocationId,
        },
        adminHeaders
      )
      expect(log2Res.status).toBe(201)

      // ── Step 3: Commit all consumption logs ──
      const commitRes = await api.post(
        `/admin/designs/${designId}/consumption-logs/commit`,
        { commitAll: true },
        adminHeaders
      )
      expect(commitRes.status).toBe(200)
      dbg("commit_result", commitRes.data)

      // ── Step 4: Verify NO inventory adjustment (stock unchanged) ──
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

      // ── Step 5: Verify raw material unit_cost was propagated ──
      const silkAfter = await rawMaterialService.retrieveRawMaterial(silkRm.id)
      const liningAfter = await rawMaterialService.retrieveRawMaterial(liningRm.id)

      dbg("raw_materials_after_commit", {
        silk: { id: silkAfter.id, unit_cost: silkAfter.unit_cost },
        lining: { id: liningAfter.id, unit_cost: liningAfter.unit_cost },
      })

      expect(Number(silkAfter.unit_cost)).toBe(150.50)
      expect(Number(liningAfter.unit_cost)).toBe(80)
    })

    it("should show non-zero material cost in design estimate after consumption commit", async () => {
      // ── Log and commit consumption with costs ──
      await api.post(
        `/admin/designs/${designId}/consumption-logs`,
        {
          inventoryItemId,
          quantity: 5,
          unitCost: 200,
          unitOfMeasure: "Meter",
          consumptionType: "sample",
          locationId: stockLocationId,
        },
        adminHeaders
      )

      await api.post(
        `/admin/designs/${designId}/consumption-logs`,
        {
          inventoryItemId: inventoryItemId2,
          quantity: 3,
          unitCost: 100,
          unitOfMeasure: "Meter",
          consumptionType: "sample",
          locationId: stockLocationId,
        },
        adminHeaders
      )

      const commitRes = await api.post(
        `/admin/designs/${designId}/consumption-logs/commit`,
        { commitAll: true },
        adminHeaders
      )
      expect(commitRes.status).toBe(200)

      // ── Preview the design order (triggers estimate workflow) ──
      const previewRes = await api.post(
        `/admin/customers/${customerId}/design-order/preview`,
        { design_ids: [designId] },
        adminHeaders
      )

      expect(previewRes.status).toBe(200)
      dbg("preview_response", previewRes.data)

      const estimates = previewRes.data.estimates
      expect(estimates).toBeDefined()
      expect(estimates.length).toBe(1)

      const designEstimate = estimates[0]
      expect(designEstimate.design_id).toBe(designId)

      // Material cost should be > 0 (inventory items now have unit_cost from propagation)
      // Silk: 200/unit * planned_quantity(10) + Lining: 100/unit * planned_quantity(5)
      // = 2000 + 500 = 2500 material cost
      expect(designEstimate.material_cost).toBeGreaterThan(0)
      dbg("design_estimate", {
        material_cost: designEstimate.material_cost,
        production_cost: designEstimate.production_cost,
        total_estimated: designEstimate.total_estimated,
        confidence: designEstimate.confidence,
      })

      // Total should include production overhead
      expect(designEstimate.total_estimated).toBeGreaterThan(designEstimate.material_cost)
      expect(previewRes.data.total).toBeGreaterThan(0)
    })

    it("should create a draft order with correct pricing from consumption-derived estimates", async () => {
      // ── Log and commit consumption ──
      await api.post(
        `/admin/designs/${designId}/consumption-logs`,
        {
          inventoryItemId,
          quantity: 3,
          unitCost: 250,
          unitOfMeasure: "Meter",
          consumptionType: "sample",
          locationId: stockLocationId,
        },
        adminHeaders
      )

      const commitRes = await api.post(
        `/admin/designs/${designId}/consumption-logs/commit`,
        { commitAll: true },
        adminHeaders
      )
      expect(commitRes.status).toBe(200)

      // ── Create draft order ──
      const orderRes = await api.post(
        `/admin/customers/${customerId}/design-order`,
        { design_ids: [designId], currency_code: "inr" },
        adminHeaders
      ).catch((err: any) => {
        dbg("draft_order_error", err?.response?.data)
        throw err
      })

      expect(orderRes.status).toBe(200)
      dbg("draft_order_response", {
        cart_id: orderRes.data.cart?.id,
        checkout_url: orderRes.data.checkout_url,
      })

      expect(orderRes.data.cart).toBeDefined()
      expect(orderRes.data.cart.id).toBeDefined()
      expect(orderRes.data.checkout_url).toBeDefined()

      // Verify the cart has line items with non-zero pricing
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: carts } = await query.graph({
        entity: "cart",
        filters: { id: orderRes.data.cart.id },
        fields: ["id", "items.*"],
      })

      const cart = carts[0]
      expect(cart.items.length).toBe(1)

      const lineItem = cart.items[0]
      dbg("line_item", {
        title: lineItem.title,
        unit_price: lineItem.unit_price,
        metadata: lineItem.metadata,
      })

      // unit_price should be > 0 (derived from consumption cost propagation)
      expect(Number(lineItem.unit_price)).toBeGreaterThan(0)

      // Metadata should reference the design
      expect(lineItem.metadata?.design_id).toBe(designId)
    })

    it("should use consumption_log fallback when inventory item unit_cost is not yet propagated", async () => {
      // This test verifies the safety-net fallback in the estimate workflow:
      // even if cost propagation didn't update inventory item unit_cost,
      // the estimate should still find cost from committed consumption logs.

      const container = getContainer()

      // ── Log consumption with unit_cost but DON'T commit ──
      // Instead, manually create a committed log to simulate the scenario
      const consumptionLogService = container.resolve("consumption_log") as any

      const log = await consumptionLogService.createConsumptionLogs({
        design_id: designId,
        inventory_item_id: inventoryItemId,
        quantity: 5,
        unit_cost: 300,
        unit_of_measure: "Meter",
        consumption_type: "sample",
        is_committed: true,
        consumed_by: "admin",
        consumed_at: new Date(),
        notes: "Pre-committed log for fallback test",
      })
      expect(log.id).toBeDefined()

      // inventory item still has NO unit_cost (we didn't propagate)
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: items } = await query.graph({
        entity: "inventory_item",
        filters: { id: inventoryItemId },
        fields: ["id", "unit_cost"],
      })
      expect(items[0].unit_cost).toBeFalsy()

      // ── Preview should still find cost via consumption_log fallback ──
      const previewRes = await api.post(
        `/admin/customers/${customerId}/design-order/preview`,
        { design_ids: [designId] },
        adminHeaders
      )

      expect(previewRes.status).toBe(200)
      dbg("fallback_preview", previewRes.data)

      const estimate = previewRes.data.estimates[0]
      // Material cost should be > 0 thanks to the consumption_log fallback
      expect(estimate.material_cost).toBeGreaterThan(0)
      dbg("fallback_estimate", {
        material_cost: estimate.material_cost,
        total_estimated: estimate.total_estimated,
        confidence: estimate.confidence,
      })
    })
  })
})
