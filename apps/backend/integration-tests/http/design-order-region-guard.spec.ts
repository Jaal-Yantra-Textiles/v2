import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/framework/types"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

/**
 * #2646: a design order's cart must not change region at checkout.
 *
 * 🔴 Prod 2026-11-26: Chirag's ₹ design order became an EMPTY AED cart 84 s
 * after it was emailed. He picked another country, the storefront moved the
 * cart to that region, and Medusa's update-cart deleted every custom-priced
 * line, which on a design order is every line.
 */
setupSharedTestSuite(() => {
  describe("design order cart: region change at checkout", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }
    let storeHeaders: { headers: Record<string, string> }
    let inrRegionId: string
    let otherRegionId: string

    const readCart = async (cartId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "cart",
        fields: [
          "id",
          "region_id",
          "currency_code",
          "items.id",
          "items.unit_price",
          "shipping_address.country_code",
          "shipping_address.city",
        ],
        filters: { id: cartId },
      })
      return data[0]
    }

    const mintCart = async () => {
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Region Guard Jacket ${Date.now()}-${Math.random()}`,
          description: "custom priced",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 8000,
          cost_currency: "inr",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id
      const res = await api
        .post(
          "/admin/designs/draft-order",
          { design_ids: [designId], currency_code: "inr", country_code: "in" },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect({ status: res.status, data: res.status === 200 ? null : res.data }).toEqual({
        status: 200,
        data: null,
      })
      return res.data.cart.id as string
    }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionService = container.resolve(Modules.REGION) as IRegionModuleService
      const { regions } = (await api.get("/admin/regions?limit=100", adminHeaders)).data
      const inr = (regions ?? []).find(
        (r: any) =>
          String(r.currency_code).toLowerCase() === "inr" &&
          (r.countries ?? []).some((c: any) => c.iso_2 === "in")
      )
      inrRegionId =
        inr?.id ??
        (
          await regionService.createRegions({
            name: "Guard INR",
            currency_code: "inr",
            countries: ["in"],
          })
        ).id
      const aed = (regions ?? []).find((r: any) =>
        (r.countries ?? []).some((c: any) => c.iso_2 === "ae")
      )
      otherRegionId =
        aed?.id ??
        (
          await regionService.createRegions({
            name: "Guard UAE",
            currency_code: "aed",
            countries: ["ae"],
          })
        ).id


      // The publishable key must reach the cart's sales channel.
      const cartId = await mintCart()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const {
        data: [cart],
      } = await query.graph({
        entity: "cart",
        fields: ["sales_channel_id"],
        filters: { id: cartId },
      })
      const keyRes = await api.post(
        "/admin/api-keys",
        { title: `region-guard-${Date.now()}`, type: "publishable" },
        adminHeaders
      )
      await api.post(
        `/admin/api-keys/${keyRes.data.api_key.id}/sales-channels`,
        { add: [cart.sales_channel_id] },
        adminHeaders
      )
      storeHeaders = { headers: { "x-publishable-api-key": keyRes.data.api_key.token } }
    })

    it("refuses a region change with the message and keeps every line", async () => {
      const cartId = await mintCart()
      const before = await readCart(cartId)
      expect(before.region_id).toBe(inrRegionId)
      expect(before.items).toHaveLength(1)

      const res = await api
        .post(`/store/carts/${cartId}`, { region_id: otherRegionId }, storeHeaders)
        .catch((e: any) => e.response)

      // The cart first: without the guard this is where the 2026-11-26 cart
      // went empty.
      const after = await readCart(cartId)
      expect(after.items.map((i: any) => i.id)).toEqual(before.items.map((i: any) => i.id))
      expect(Number(after.items[0].unit_price)).toBe(8000)
      expect(after.region_id).toBe(inrRegionId)
      expect(after.currency_code).toBe("inr")

      expect(res.status).toBe(400)
      expect(res.data.message).toBe(
        "This order is priced in INR. To pay in another currency, ask us for a new design order."
      )
    })

    it("still takes a shipping address inside the same region", async () => {
      const cartId = await mintCart()

      const res = await api.post(
        `/store/carts/${cartId}`,
        {
          shipping_address: {
            first_name: "Chirag",
            last_name: "B",
            address_1: "1 MG Road",
            city: "Delhi",
            postal_code: "110001",
            country_code: "in",
          },
        },
        storeHeaders
      )
      expect(res.status).toBe(200)

      const after = await readCart(cartId)
      expect(after.region_id).toBe(inrRegionId)
      expect(after.shipping_address.city).toBe("Delhi")
      expect(after.items).toHaveLength(1)
    })

    it("leaves an ordinary cart free to change region", async () => {
      const cartModule: any = getContainer().resolve(Modules.CART)
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const minted = await mintCart()
      const {
        data: [ref],
      } = await query.graph({ entity: "cart", fields: ["sales_channel_id"], filters: { id: minted } })
      const cart = await cartModule.createCarts({
        region_id: inrRegionId,
        currency_code: "inr",
        sales_channel_id: ref.sales_channel_id,
      })

      const res = await api.post(`/store/carts/${cart.id}`, { region_id: otherRegionId }, storeHeaders)
      expect(res.status).toBe(200)
      expect((await readCart(cart.id)).region_id).toBe(otherRegionId)
    })
  })
})
