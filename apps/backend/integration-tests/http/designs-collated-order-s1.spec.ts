import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { createTestCustomer } from "../helpers/create-customer"
import { DESIGN_MODULE } from "../../src/modules/designs"
import designLineItemLink from "../../src/links/design-line-item-link"

jest.setTimeout(90 * 1000)

/**
 * #826 S1 — "Create Order" from the general Designs list.
 *
 * The admin selects N designs on the general list and creates ONE collated
 * commissioning order (the grouping key the partner-side collation later keys
 * on via run.order_id). This exercises the two backend behaviours S1 added/
 * relies on:
 *   1. GET /admin/designs enriches each design with its linked `customer_id`
 *      (so the UI can auto-resolve a single customer for the selection).
 *   2. POST /admin/customers/:id/design-order collates the selected designs
 *      into one cart with one line item per design (already `design_ids[]`-native).
 */
setupSharedTestSuite(() => {
  describe("#826 S1 — collated design order from the Designs list", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerId: string
    let designIds: string[] = []

    const { api, getContainer } = getSharedTestEnv()

    beforeAll(async () => {
      const container = getContainer()

      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // A region is required for the draft-order/cart create.
      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (!regionsRes.data.regions?.length) {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        await regionService.createRegions({
          name: "S1 Test Region",
          currency_code: "inr",
          countries: ["in"],
        })
      }

      const { customer } = await createTestCustomer(container)
      customerId = customer.id

      // Two commerce-ready designs, both linked to the SAME customer — the
      // single-customer selection S1 supports.
      const unique = Date.now()
      for (let i = 0; i < 2; i++) {
        const designRes = await api.post(
          "/admin/designs",
          {
            name: `S1 Collated Design ${unique}-${i}`,
            description: "S1 collated order test",
            design_type: "Original",
            status: "Commerce_Ready",
            priority: "Medium",
            estimated_cost: 100 + i * 50,
          },
          adminHeaders
        )
        expect(designRes.status).toBe(201)
        const id = designRes.data.design.id
        designIds.push(id)

        const remoteLink = container.resolve(
          ContainerRegistrationKeys.LINK
        ) as any
        await remoteLink.create({
          [DESIGN_MODULE]: { design_id: id },
          [Modules.CUSTOMER]: { customer_id: customerId },
        })
      }
    })

    it("enriches GET /admin/designs with each design's linked customer_id", async () => {
      const res = await api.get("/admin/designs?limit=100", adminHeaders)
      expect(res.status).toBe(200)

      const byId: Record<string, any> = {}
      for (const d of res.data.designs as any[]) {
        byId[d.id] = d
      }

      for (const id of designIds) {
        expect(byId[id]).toBeDefined()
        // The enrichment attaches the linked customer so the list-level
        // multi-select can auto-resolve a single customer.
        expect(byId[id].customer_id).toBe(customerId)
      }
    })

    it("previews all selected designs as line items in one estimate", async () => {
      const res = await api.post(
        `/admin/customers/${customerId}/design-order/preview`,
        { design_ids: designIds },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.estimates)).toBe(true)
      expect(res.data.estimates).toHaveLength(designIds.length)

      const previewedDesignIds = (res.data.estimates as any[])
        .map((e) => e.design_id)
        .sort()
      expect(previewedDesignIds).toEqual([...designIds].sort())
    })

    it("collates the selected designs into ONE order with a line per design", async () => {
      const container = getContainer()
      const res = await api.post(
        `/admin/customers/${customerId}/design-order`,
        { design_ids: designIds },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.cart).toBeDefined()

      const cart = res.data.cart
      expect(res.data.checkout_url).toContain(cart.id)

      // One cart (one order), one line item per selected design — the collation.
      // The workflow returns the cart without its items relation hydrated, so
      // read the persisted line items directly.
      const cartService = container.resolve(Modules.CART) as any
      const lineItems = await cartService.listLineItems(
        { cart_id: [cart.id] },
        { select: ["id"] }
      )
      expect(lineItems).toHaveLength(designIds.length)

      // Each design is linked to exactly one of the cart's line items.
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: designLinks } = await query.graph({
        entity: designLineItemLink.entryPoint,
        filters: { line_item_id: lineItems.map((li: any) => li.id) },
        fields: ["design_id"],
      })
      const linkedDesignIds = (designLinks as any[])
        .map((l) => l.design_id)
        .sort()
      expect(linkedDesignIds).toEqual([...designIds].sort())
    })
  })
})
