import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"

jest.setTimeout(90000)

/**
 * #729 — public storefront "production story" for a design.
 *
 * Verifies GET /store/custom/designs/:id/production-story (PUBLIC, no auth)
 * surfaces the v2 story: production runs + energy/consumption + people +
 * materials, money-free; and that a design with nothing returns a clean
 * empty story.
 */
setupSharedTestSuite(() => {
  describe("Store: design production story (#729)", () => {
    const { api, getContainer } = getSharedTestEnv()

    let adminHeaders: any
    let storeHeaders: any
    let designId: string
    let inventoryItemId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Publishable API key (required for /store/* routes)
      const { result: apiKeys } = await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [
            { type: "publishable", title: "Story Test Key", created_by: "admin" },
          ],
        },
      })
      const pubKey = apiKeys[0]
      const storeService = container.resolve(Modules.STORE) as any
      const stores = await storeService.listStores({})
      if (stores?.[0]?.default_sales_channel_id) {
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: pubKey.id, add: [stores[0].default_sales_channel_id] },
        })
      }
      storeHeaders = { headers: { "x-publishable-api-key": pubKey.token } }

      // Stock location + inventory item
      const stockLocRes = await api.post(
        "/admin/stock-locations",
        { name: "Story Warehouse" },
        adminHeaders
      )
      const stockLocationId = stockLocRes.data.stock_location.id

      const invRes = await api.post(
        "/admin/inventory-items",
        { title: "Story Silk", description: "Silk for story test" },
        adminHeaders
      )
      inventoryItemId = invRes.data.inventory_item.id

      // Raw material linked to the inventory item (materials story)
      const rawMaterialService = container.resolve("raw_materials") as any
      const rm = await rawMaterialService.createRawMaterials({
        name: "Story Cotton",
        description: "Cotton for the story",
        composition: "100% Cotton",
        color: "white",
        unit_of_measure: "Meter",
        status: "Active",
      })
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create([
        {
          [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
          raw_materials: { raw_materials_id: rm.id },
        },
      ])

      // Design + link inventory
      const designRes: any = await api.post(
        "/admin/designs",
        {
          name: "Story Test Design",
          description: "Design for production story test",
          design_type: "Original",
          status: "Sample_Production",
          priority: "High",
        },
        adminHeaders
      )
      designId = designRes.data.design.id

      await api.post(
        `/admin/designs/${designId}/inventory`,
        {
          inventoryItems: [
            { inventoryId: inventoryItemId, plannedQuantity: 10, locationId: stockLocationId },
          ],
        },
        adminHeaders
      )

      // Link a person to the design (people story) — via the designs-person link
      const personRes: any = await api.post(
        "/admin/persons",
        { first_name: "Maker", last_name: "One", email: "maker.one@story.test" },
        adminHeaders
      )
      const personId = personRes.data.person.id
      await remoteLink.create({
        design: { design_id: designId },
        person: { person_id: personId },
      })

      // Production run for the design
      const runRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 10, run_type: "production" },
        adminHeaders
      )
      expect([200, 201]).toContain(runRes.status)

      // Consumption logs — energy + a material sample
      await api.post(
        `/admin/designs/${designId}/consumption-logs`,
        { inventoryItemId, quantity: 12, unitOfMeasure: "kWh", consumptionType: "energy_electricity" },
        adminHeaders
      )
      await api.post(
        `/admin/designs/${designId}/consumption-logs`,
        { inventoryItemId, quantity: 3, unitOfMeasure: "Meter", consumptionType: "sample" },
        adminHeaders
      )
    })

    it("returns runs + consumption + people + materials (public, money-free)", async () => {
      // No auth headers — this is a public route.
      const res = await api.get(
        `/store/custom/designs/${designId}/production-story`,
        storeHeaders
      )

      expect(res.status).toBe(200)
      const story = res.data.production_story
      expect(story).toBeDefined()
      expect(story.design_id).toBe(designId)

      // Production runs
      expect(Array.isArray(story.runs)).toBe(true)
      expect(story.runs.length).toBeGreaterThanOrEqual(1)
      expect(story.runs[0]).toHaveProperty("status")

      // Energy + consumption
      expect(story.consumption.energy.electricity_kwh).toBe(12)
      expect(story.consumption.total_logs).toBeGreaterThanOrEqual(2)
      expect(story.consumption.materials_consumed.length).toBeGreaterThanOrEqual(1)

      // People
      expect(story.people.length).toBeGreaterThanOrEqual(1)
      expect(story.people[0].name).toBe("Maker One")

      // Materials
      expect(story.materials.length).toBeGreaterThanOrEqual(1)
      expect(story.materials[0]).toHaveProperty("name", "Story Cotton")

      // Public-safe: no money leaks
      const json = JSON.stringify(story)
      expect(json).not.toContain("unit_cost")
      expect(json).not.toContain("partner_cost_estimate")
    })

    it("returns a clean empty story for a design with nothing", async () => {
      const emptyRes: any = await api.post(
        "/admin/designs",
        {
          name: "Empty Story Design",
          description: "Design with no runs/consumption/people/materials",
          design_type: "Original",
          status: "Conceptual",
          priority: "Low",
        },
        adminHeaders
      )
      const emptyId = emptyRes.data.design.id

      const res = await api.get(
        `/store/custom/designs/${emptyId}/production-story`,
        storeHeaders
      )

      expect(res.status).toBe(200)
      const story = res.data.production_story
      expect(story.runs).toEqual([])
      expect(story.people).toEqual([])
      expect(story.partners).toEqual([])
      expect(story.materials).toEqual([])
      expect(story.consumption.total_logs).toBe(0)
      expect(story.consumption.energy.electricity_kwh).toBe(0)
    })

    it("404s for an unknown design", async () => {
      const res = await api
        .get(`/store/custom/designs/design_does_not_exist/production-story`, storeHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })
  })
})
