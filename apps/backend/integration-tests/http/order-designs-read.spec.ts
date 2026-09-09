import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(120 * 1000)

/**
 * GET /admin/orders/:id/design — the read that answered "no designs" about an
 * order full of them.
 *
 * 🔴 Found on prod. Order #101 (nine garments, deposit paid, A$220.34
 * outstanding) returned `{ design: null, designs: [] }` while every one of its
 * four line items pointed at a design-created product. The route answered from
 * the ORDER-level `design_order` link alone, and a quote-accepted order never
 * gets one.
 *
 * That is not a cosmetic read. `produce_order_designs` names this route as its
 * preview and tells the caller to "call list_order_designs first" — so an
 * operator checking before producing is told there is nothing to produce, and
 * nothing ever is. The produce path itself resolves through the LINE ITEMS and
 * would have worked. Only the answer to "is there anything here?" was wrong.
 *
 * A confident nothing is worse than an error: an error gets investigated.
 */
setupSharedTestSuite(() => {
  describe("GET /admin/orders/:id/design — resolves through the line items", () => {
    let adminHeaders: { headers: Record<string, string> }
    let regionId: string

    const { api, getContainer } = getSharedTestEnv()

    const makeDesign = async (name: string): Promise<string> => {
      const res = await api.post(
        "/admin/designs",
        {
          name,
          description: "order-designs read spec",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
          estimated_cost: 500,
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id as string
    }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Order Designs Read Region",
          currency_code: "inr",
          countries: ["in"],
        })
        regionId = region.id
      }
    })

    it("finds the design through a PRODUCT link when the order has no design_order row", async () => {
      const container = getContainer()
      const stamp = Date.now()

      // A design, approved into a real product — the shape a quote-accepted
      // order carries: a product line, no order-level design link anywhere.
      const designId = await makeDesign(`Order Read ${stamp}`)
      const approve = await api.post(
        `/admin/designs/${designId}/approve`,
        {},
        adminHeaders
      )
      expect(approve.status).toBe(200)
      const productId = approve.data.product_id as string
      const variantId = approve.data.variant_id as string

      // Approval mints the product as a DRAFT, and `createOrderWorkflow`
      // refuses a variant whose product is not published — the prod order's
      // products are published, so publish to match it.
      const published = await api.post(
        `/admin/products/${productId}`,
        { status: "published" },
        adminHeaders
      )
      expect(published.status).toBe(200)

      /**
       * ...and made-to-order, like the prod variants. A tracked variant with no
       * stock location on the sales channel is refused by the order workflow —
       * the same `manage_inventory` default that bites at checkout.
       * No `prices` key: a variant update that omits it keeps the price row.
       */
      const untracked = await api.post(
        `/admin/products/${productId}/variants/${variantId}`,
        { manage_inventory: false },
        adminHeaders
      )
      expect(untracked.status).toBe(200)

      const { result: order }: any = await createOrderWorkflow(container).run({
        input: {
          status: "pending",
          email: `order-read-${stamp}@jyt.test`,
          region_id: regionId,
          currency_code: "inr",
          items: [
            {
              title: "Approved design piece",
              quantity: 2,
              unit_price: 500,
              variant_id: variantId,
              product_id: productId,
              // 🔴 No metadata.design_id, exactly like the prod order: the only
              // route to the design is the product/variant link.
              metadata: {},
            },
          ] as any,
        } as any,
      })

      // Nothing wrote an order-level link — the precondition for the bug.
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: orderLinks } = await query.graph({
        entity: "design_order",
        filters: { order_id: order.id },
        fields: ["design_id"],
      })
      expect(orderLinks ?? []).toHaveLength(0)

      const res = await api.get(
        `/admin/orders/${order.id}/design`,
        adminHeaders
      )
      expect(res.status).toBe(200)

      // 🔴 The assertion the old route failed: it answered `designs: []` here.
      expect(res.data.designs).toHaveLength(1)
      expect(res.data.designs[0].id).toBe(designId)
      expect(res.data.design.id).toBe(designId)

      // And it says WHICH line, so a caller can act on the answer rather than
      // just believe it.
      expect(res.data.designs[0].order_line_item_ids).toEqual([
        order.items[0].id,
      ])
      // Resolved through the catalogue link, not an order-level one.
      expect(["product", "variant"]).toContain(
        res.data.designs[0].design_source
      )
    })

    it("still answers from the order-level link when there are no design line items", async () => {
      const container = getContainer()
      const stamp = Date.now()
      const designId = await makeDesign(`Order Read Link ${stamp}`)

      const { result: order }: any = await createOrderWorkflow(container).run({
        input: {
          status: "pending",
          email: `order-read-link-${stamp}@jyt.test`,
          region_id: regionId,
          currency_code: "inr",
          items: [
            { title: "Plain item", quantity: 1, unit_price: 100 },
          ] as any,
        } as any,
      })

      const remoteLink = container.resolve(
        ContainerRegistrationKeys.LINK
      ) as any
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.ORDER]: { order_id: order.id },
      })

      const res = await api.get(
        `/admin/orders/${order.id}/design`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.designs.map((d: any) => d.id)).toEqual([designId])
      /**
       * No line carries it — reported as such rather than implied. This is the
       * case a caller must NOT send to production blindly, and the empty array
       * is how it says so.
       */
      expect(res.data.designs[0].order_line_item_ids).toEqual([])
      expect(res.data.designs[0].design_source).toBe("order_link")
    })

    it("returns the backwards-compatible empty shape for an order with no designs at all", async () => {
      const stamp = Date.now()
      const { result: order }: any = await createOrderWorkflow(
        getContainer()
      ).run({
        input: {
          status: "pending",
          email: `order-read-none-${stamp}@jyt.test`,
          region_id: regionId,
          currency_code: "inr",
          items: [
            { title: "Just a thing", quantity: 1, unit_price: 100 },
          ] as any,
        } as any,
      })

      const res = await api.get(
        `/admin/orders/${order.id}/design`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data).toEqual({ design: null, designs: [] })
    })
  })
})
