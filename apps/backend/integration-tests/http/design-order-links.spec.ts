import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { linkDesignsToOrder } from "../../src/workflows/designs/link-designs-to-order"
import designOrderLink from "../../src/links/design-order-link"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60000)

// Roadmap #29 / issue #379: customer purchases never reflected on the
// admin "Design Orders" view because the order.placed subscriber's
// design→order linking read `cart_id` off the order model (it's the
// order_cart LINK) and silently no-oped. linkDesignsToOrder is the
// fixed shared traversal (subscriber + backfill).
setupSharedTestSuite(() => {
  describe("design → order linking on purchase", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: any

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    async function seedPurchase() {
      const container = getContainer()
      const unique = Date.now() + Math.floor(Math.random() * 1000)

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Design Order Link ${unique}`,
          description: "x",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      // Cart with one line item (the design-to-cart flow shape)
      const cartService: any = container.resolve(Modules.CART)
      const cart = await cartService.createCarts({ currency_code: "inr" })
      const [lineItem] = await cartService.addLineItems([
        {
          cart_id: cart.id,
          title: `Design ${unique}`,
          quantity: 1,
          unit_price: 1000,
        },
      ])

      // design ↔ cart line item (created when the design is added to cart)
      const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CART]: { line_item_id: lineItem.id },
      })

      // Customer completes the cart → an order exists, linked via order_cart
      const orderService: any = container.resolve(Modules.ORDER)
      const order = await orderService.createOrders({
        currency_code: "inr",
        items: [{ title: `Design ${unique}`, quantity: 1, unit_price: 1000 }],
      })
      await remoteLink.create({
        [Modules.ORDER]: { order_id: order.id },
        [Modules.CART]: { cart_id: cart.id },
      })

      return { container, designId, cartId: cart.id, orderId: order.id }
    }

    it("links the cart's designs to the order (idempotently)", async () => {
      const { container, designId, orderId } = await seedPurchase()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

      const first = await linkDesignsToOrder(container as any, orderId)
      expect(first.linked).toBe(1)
      expect(first.design_ids).toEqual([designId])

      const { data: links } = await query.graph({
        entity: designOrderLink.entryPoint,
        filters: { order_id: orderId },
        fields: ["design_id"],
      })
      expect((links || []).map((l: any) => l.design_id)).toContain(designId)

      // Idempotent
      const second = await linkDesignsToOrder(container as any, orderId)
      expect(second.linked).toBe(0)
    })

    it("dry-run reports the would-be links without writing", async () => {
      const { container, designId, orderId } = await seedPurchase()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

      const dry = await linkDesignsToOrder(container as any, orderId, {
        dryRun: true,
      })
      expect(dry.linked).toBe(1)
      expect(dry.design_ids).toEqual([designId])

      const { data: links } = await query.graph({
        entity: designOrderLink.entryPoint,
        filters: { order_id: orderId },
        fields: ["design_id"],
      })
      expect(links || []).toHaveLength(0)
    })

    it("admin design-orders view shows the order once linked", async () => {
      const { container, designId, orderId } = await seedPurchase()
      await linkDesignsToOrder(container as any, orderId)

      const res = await api.get("/admin/designs/orders?limit=50", adminHeaders)
      expect(res.status).toBe(200)
      const group = (res.data.design_orders || []).find((g: any) =>
        (g.items || []).some((i: any) => i.design?.id === designId)
      )
      expect(group).toBeDefined()
      expect(group.order).toBeTruthy()
      expect(group.order.id).toBe(orderId)
    })
  })
})
