import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"

jest.setTimeout(90000)

/**
 * #729 — public storefront "production story" for a design.
 *
 * Verifies GET /store/custom/designs/:id/production-story (PUBLIC, no auth)
 * returns only a teaser (run status, materials, first/last step) and that
 * POST …/share emails the full story once per address and logs the lead.
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

    it("returns a teaser: makers' materials and run status, not people or energy", async () => {
      // No auth headers — this is a public route.
      const res = await api.get(
        `/store/custom/designs/${designId}/production-story`,
        storeHeaders
      )

      expect(res.status).toBe(200)
      const story = res.data.production_story
      expect(story).toBeDefined()
      expect(story.design_id).toBe(designId)

      // Production runs: status yes, per-run steps no
      expect(Array.isArray(story.runs)).toBe(true)
      expect(story.runs.length).toBeGreaterThanOrEqual(1)
      expect(story.runs[0]).toHaveProperty("status")
      expect(story.runs[0].activity).toEqual([])
      expect(story.journey).toBeDefined()

      // Withheld until a shopper asks by email
      expect(story.people).toEqual([])
      expect(story.consumption.energy.electricity_kwh).toBe(0)
      expect(story.consumption.materials_consumed).toEqual([])
      expect(JSON.stringify(story)).not.toContain("Maker One")

      // Materials stay public
      expect(story.materials.length).toBeGreaterThanOrEqual(1)
      expect(story.materials[0]).toHaveProperty("name", "Story Cotton")

      // Public-safe: no money leaks
      const json = JSON.stringify(story)
      expect(json).not.toContain("unit_cost")
      expect(json).not.toContain("partner_cost_estimate")
    })

    it("names each fabric's supplier from its purchase order, and each maker's stage (#2442)", async () => {
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      const partnerService: any = container.resolve(PARTNER_MODULE)
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const mill = await partnerService.createPartners({ name: "HR Handloom", handle: `hr-${unique}` })
      const wrong = await partnerService.createPartners({ name: "Cancelled Mill", handle: `cx-${unique}` })
      const tailor = await partnerService.createPartners({ name: "Sharlho", handle: `sh-${unique}` })

      const loc = await api.post("/admin/stock-locations", { name: "Supplier Story WH" }, adminHeaders)
      const buy = async (status: string) => {
        const res = await api.post(
          "/admin/inventory-orders",
          {
            order_lines: [{ inventory_item_id: inventoryItemId, quantity: 5, price: 100 }],
            quantity: 5,
            total_price: 500,
            status,
            expected_delivery_date: new Date().toISOString(),
            order_date: new Date().toISOString(),
            shipping_address: { first_name: "JYT", address_1: "Mill Road 1", city: "Jaipur", country_code: "in", postal_code: "302001" },
            stock_location_id: loc.data.stock_location.id,
          },
          adminHeaders
        )
        expect(res.status).toBe(201)
        return res.data.inventoryOrder?.id ?? res.data.inventory_order?.id
      }
      const goodOrder = await buy("Pending")
      expect(goodOrder).toBeTruthy()
      // A newer order from another mill, then cancelled: it must not win.
      const cancelledOrder = await buy("Pending")
      await container.resolve(ORDER_INVENTORY_MODULE).updateInventoryOrders({ id: cancelledOrder, status: "Cancelled" })

      await remoteLink.create([
        { [PARTNER_MODULE]: { partner_id: mill.id }, [ORDER_INVENTORY_MODULE]: { inventory_orders_id: goodOrder } },
        { [PARTNER_MODULE]: { partner_id: wrong.id }, [ORDER_INVENTORY_MODULE]: { inventory_orders_id: cancelledOrder } },
      ])
      const roster = await api.post(
        `/admin/designs/${designId}/partner`,
        { partners: [{ partner_id: tailor.id, stage_role: "stitching" }] },
        adminHeaders
      )
      expect([200, 201]).toContain(roster.status)

      const res = await api.get(`/store/custom/designs/${designId}/production-story`, storeHeaders)
      const story = res.data.production_story
      const cotton = story.materials.find((m: any) => m.name === "Story Cotton")
      expect(cotton.supplier).toEqual({ id: mill.id, name: "HR Handloom" })
      expect(story.partners).toEqual(
        expect.arrayContaining([{ id: tailor.id, name: "Sharlho", stage_role: "stitching" }])
      )
    })

    describe("share: the full story by email", () => {
      const listStoryRequests = async () => {
        const notifications = getContainer().resolve(Modules.NOTIFICATION) as any
        const rows = await notifications.listNotifications({ channel: "feed" })
        return (rows || []).filter(
          (n: any) => n?.data?.metadata?.kind === "production_story_request"
        )
      }

      beforeEach(async () => {
        const { emailTemplatesData } = await import("../../src/scripts/seed-email-templates")
        const { EMAIL_TEMPLATES_MODULE } = await import("../../src/modules/email_templates")
        const template = emailTemplatesData.find((t: any) => t.template_key === "production-story")
        await (getContainer().resolve(EMAIL_TEMPLATES_MODULE) as any).createEmailTemplates(template)
      })

      it("emails the story once per address and logs the lead", async () => {
        const first = await api.post(
          `/store/custom/designs/${designId}/production-story/share`,
          { email: "Buyer@Story.test", product_title: "Story Dress" },
          storeHeaders
        )
        expect(first.status).toBe(200)
        expect(first.data.sent).toBe(true)

        const again = await api.post(
          `/store/custom/designs/${designId}/production-story/share`,
          { email: "buyer@story.test" },
          storeHeaders
        )
        expect(again.status).toBe(200)

        const alerts = await listStoryRequests()
        expect(alerts).toHaveLength(1)
        expect(alerts[0].data.metadata.email).toBe("buyer@story.test")
        expect(alerts[0].data.metadata.design_id).toBe(designId)

        // Recorded as ONE lead beside the ad leads, still `new` for follow-up
        const socials = getContainer().resolve("socials") as any
        const leads = await socials.listLeads({ email: "buyer@story.test" })
        expect(leads).toHaveLength(1)
        expect(leads[0].meta_lead_id).toBe(`story:${designId}:buyer@story.test`)
        expect(leads[0].source_platform).toBe("storefront")
        expect(leads[0].form_name).toBe("production_story")
        expect(leads[0].status).toBe("new")
        expect(leads[0].field_data.design_id).toBe(designId)
      })

      it("refuses a malformed email and an unknown design", async () => {
        const bad = await api
          .post(
            `/store/custom/designs/${designId}/production-story/share`,
            { email: "not-an-email" },
            storeHeaders
          )
          .catch((e: any) => e.response)
        expect(bad.status).toBe(400)

        const missing = await api
          .post(
            `/store/custom/designs/des_does_not_exist/production-story/share`,
            { email: "buyer@story.test" },
            storeHeaders
          )
          .catch((e: any) => e.response)
        expect(missing.status).toBe(404)
        expect(await listStoryRequests()).toHaveLength(0)
      })
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
