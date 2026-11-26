/**
 * Public buyer feedback page — GET/POST /web/feedback/:id.
 *
 * The delivery email links buyers to `<shop>/feedback/<feedback_id>`; the
 * storefront page reads and writes through these routes. Pinned:
 *   - GET shows what was ordered (titles/thumbnail/qty, order number) and NOT
 *     the buyer's email/address/phone
 *   - a partner-store order resolves the PARTNER's domain + store name
 *   - POST needs a rating, stamps `answered_at`, and the row reads back
 *   - a second POST is a 409 and does not overwrite the first answer
 *   - a feedback row that is not about an order (partner/task feedback) is a
 *     404 on both GET and POST
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { FEEDBACK_MODULE } from "../../src/modules/feedback"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(90 * 1000)

setupSharedTestSuite(() => {
  describe("buyer feedback page /web/feedback/:id", () => {
    const { api, getContainer } = getSharedTestEnv()
    const prevStoreUrl = process.env.STORE_URL

    beforeAll(() => {
      process.env.STORE_URL = "https://shop.jyt.test/"
    })
    afterAll(() => {
      if (prevStoreUrl === undefined) delete process.env.STORE_URL
      else process.env.STORE_URL = prevStoreUrl
    })

    const createOrder = async (unique: number, salesChannelId?: string) => {
      const orderService: any = getContainer().resolve(Modules.ORDER)
      return (await orderService.createOrders({
        currency_code: "inr",
        email: `buyer-${unique}@jyt.test`,
        ...(salesChannelId ? { sales_channel_id: salesChannelId } : {}),
        shipping_address: {
          first_name: "Asha",
          address_1: "12 Secret Lane",
          city: "Dharamshala",
          country_code: "in",
          phone: "+919999900000",
        },
        items: [
          {
            title: "Default variant",
            product_title: `Indigo Stole ${unique}`,
            variant_title: "Default variant",
            thumbnail: "https://cdn.example.com/stole.jpg",
            quantity: 2,
            unit_price: 1000,
          },
        ],
      } as any)) as any
    }

    const createRequest = async (orderId: string | null) => {
      const service: any = getContainer().resolve(FEEDBACK_MODULE)
      return service.createFeedbacks({
        order_id: orderId,
        submitted_by: "buyer@jyt.test",
        submitted_at: new Date(),
        status: "pending",
        metadata: { source: "post_delivery_request" },
      })
    }

    it("shows the order, takes one answer, and refuses a second", async () => {
      const unique = Date.now()
      const order = await createOrder(unique)
      const feedback = await createRequest(order.id)

      const get1 = await api.get(`/web/feedback/${feedback.id}`)
      expect(get1.status).toBe(200)
      expect(get1.data.feedback).toMatchObject({
        id: feedback.id,
        answered: false,
        rating: null,
      })
      expect(get1.data.order.display_id).toBe(order.display_id)
      expect(get1.data.order.items).toEqual([
        {
          title: `Indigo Stole ${unique}`,
          variant_title: null,
          thumbnail: "https://cdn.example.com/stole.jpg",
          quantity: 2,
        },
      ])
      // Our own order → our shop (STORE_URL), no partner name.
      expect(get1.data.store).toEqual({ name: null, url: "https://shop.jyt.test" })
      // No buyer PII in the public payload.
      const body = JSON.stringify(get1.data)
      expect(body).not.toContain(`buyer-${unique}@jyt.test`)
      expect(body).not.toContain("Secret Lane")
      expect(body).not.toContain("+919999900000")

      // A rating is required.
      const noRating = await api
        .post(`/web/feedback/${feedback.id}`, { comment: "hi" })
        .catch((e: any) => e.response)
      expect(noRating.status).toBe(400)

      const post = await api.post(`/web/feedback/${feedback.id}`, {
        rating: 5,
        comment: "  Beautiful weave  ",
      })
      expect(post.status).toBe(200)
      expect(post.data.feedback).toMatchObject({
        answered: true,
        rating: "five",
        comment: "Beautiful weave",
      })

      // Read the row back — the write persisted.
      const service: any = getContainer().resolve(FEEDBACK_MODULE)
      const [row] = await service.listFeedbacks({ id: feedback.id })
      expect(row.rating).toBe("five")
      expect(row.comment).toBe("Beautiful weave")
      expect(row.answered_at).toBeTruthy()
      // Admin review state is untouched by the buyer's answer.
      expect(row.status).toBe("pending")

      const again = await api
        .post(`/web/feedback/${feedback.id}`, { rating: 1, comment: "overwrite" })
        .catch((e: any) => e.response)
      expect(again.status).toBe(409)
      const [after] = await service.listFeedbacks({ id: feedback.id })
      expect(after.rating).toBe("five")
      expect(after.comment).toBe("Beautiful weave")

      const get2 = await api.get(`/web/feedback/${feedback.id}`)
      expect(get2.data.feedback).toMatchObject({ answered: true, rating: "five" })
      expect(get2.data.artworks).toEqual([])
    })

    it("a partner-store order resolves the partner's own domain and name", async () => {
      const unique = Date.now() + 7
      const container = getContainer()
      const link: any = container.resolve(ContainerRegistrationKeys.LINK)
      const partner = await (container.resolve(PARTNER_MODULE) as any).createPartners({
        name: `Loom House ${unique}`,
        handle: `loom-house-${unique}`,
        storefront_domain: `loom-${unique}.cicilabel.com`,
      })
      const channel = await (container.resolve(Modules.SALES_CHANNEL) as any).createSalesChannels({
        name: `Loom SC ${unique}`,
      })
      const store = await (container.resolve(Modules.STORE) as any).createStores({
        name: `Loom Store ${unique}`,
        default_sales_channel_id: channel.id,
      })
      await link.create({
        [PARTNER_MODULE]: { partner_id: partner.id },
        [Modules.STORE]: { store_id: store.id },
      })

      const order = await createOrder(unique, channel.id)
      const feedback = await createRequest(order.id)

      const res = await api.get(`/web/feedback/${feedback.id}`)
      expect(res.status).toBe(200)
      expect(res.data.store).toEqual({
        name: `Loom Store ${unique}`,
        url: `https://loom-${unique}.cicilabel.com`,
      })
    })

    it("404s a feedback row that is not about an order, on GET and POST", async () => {
      const other = await createRequest(null)
      const get = await api.get(`/web/feedback/${other.id}`).catch((e: any) => e.response)
      expect(get.status).toBe(404)
      const post = await api
        .post(`/web/feedback/${other.id}`, { rating: 1 })
        .catch((e: any) => e.response)
      expect(post.status).toBe(404)

      const service: any = getContainer().resolve(FEEDBACK_MODULE)
      const [row] = await service.listFeedbacks({ id: other.id })
      expect(row.answered_at).toBeFalsy()
    })

    it("404s an unknown id", async () => {
      const res = await api
        .get(`/web/feedback/feedback_01NOTAREALID0000000000000`)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })
  })
})
