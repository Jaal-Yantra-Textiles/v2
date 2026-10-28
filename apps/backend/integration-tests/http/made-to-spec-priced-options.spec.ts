import { Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createTestCustomer,
  getCustomerAuthHeaders,
} from "../helpers/create-customer"

jest.setTimeout(120 * 1000)

/**
 * #2456 — a priced spec choice (logo embroidery: setup fee + per-piece) is
 * actually charged at the cart, not just shown.
 *
 * Everything runs in ONE `it`: the shared runner resets the customer
 * publishable-key session and cart data between `it` blocks.
 */
setupSharedTestSuite(() => {
  describe("made-to-spec priced choices (#2456)", () => {
    const { api, getContainer } = getSharedTestEnv()

    it("adds the per-piece surcharge to the line and the setup fee once", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      let region = regionsRes.data.regions?.[0]
      if (!region) {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        region = await regionService.createRegions({
          name: "Priced Spec Region",
          currency_code: "usd",
          countries: ["us"],
        })
      }
      const currency = region.currency_code

      await createTestCustomer(container)
      const customerHeaders = await getCustomerAuthHeaders()

      const storeModule: any = container.resolve(Modules.STORE)
      const [store] = await storeModule.listStores({})
      const salesChannelId = store?.default_sales_channel_id
      expect(salesChannelId).toBeTruthy()

      const productRes = await api.post(
        "/admin/products",
        {
          title: `Apron ${Date.now()}`,
          status: "published",
          options: [{ title: "Size", values: ["One size", "Kids"] }],
          sales_channels: [{ id: salesChannelId }],
          variants: [
            {
              title: "One size",
              options: { Size: "One size" },
              manage_inventory: false,
              prices: [{ currency_code: currency, amount: 40 }],
            },
            {
              title: "Kids",
              options: { Size: "Kids" },
              manage_inventory: false,
              prices: [{ currency_code: currency, amount: 30 }],
            },
          ],
        },
        adminHeaders
      )
      expect(productRes.status).toBe(200)
      const product = productRes.data.product
      const apron = product.variants.find((v: any) => v.title === "One size")
      const kids = product.variants.find((v: any) => v.title === "Kids")

      // A priced choice with no currency is refused at the door.
      const noCurrency = await api
        .post(
          `/admin/products/${product.id}/spec`,
          {
            accepting_custom_orders: true,
            options: [
              { key: "logo", values: [{ label: "Yes", price_per_piece: 1.5 }] },
            ],
          },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(noCurrency.status).toBe(400)

      const specRes = await api.post(
        `/admin/products/${product.id}/spec`,
        {
          accepting_custom_orders: true,
          options: [
            {
              key: "logo",
              label: "Logo",
              variant_ids: [apron.id],
              values: [
                { label: "No logo" },
                {
                  label: "My logo embroidered",
                  price_per_piece: 1.5,
                  setup_fee: 5,
                  price_currency_code: currency,
                },
              ],
            },
          ],
        },
        adminHeaders
      )
      expect(specRes.status).toBe(200)

      // The public read says what the choice costs, before the cart does.
      const publicSpec = await api.get(
        `/store/products/${product.id}/spec`,
        customerHeaders
      )
      const logo = publicSpec.data.spec.options[0]
      expect(logo.variant_ids).toEqual([apron.id])
      expect(logo.values[1]).toMatchObject({
        price_per_piece: 1.5,
        setup_fee: 5,
        price_currency_code: currency,
      })

      const cartRes = await api.post(
        "/store/carts",
        { region_id: region.id },
        customerHeaders
      )
      const cartId = cartRes.data.cart.id

      const add = () =>
        api.post(
          `/store/carts/${cartId}/made-to-spec`,
          {
            variant_id: apron.id,
            quantity: 3,
            options: { logo: "My logo embroidered" },
          },
          customerHeaders
        )
      expect((await add()).status).toBe(200)
      // Same logo again in the same cart: more aprons, not a second setup.
      expect((await add()).status).toBe(200)

      // Scoped to the apron variant — refused on the kids' one.
      const onKids = await api
        .post(
          `/store/carts/${cartId}/made-to-spec`,
          { variant_id: kids.id, options: { logo: "My logo embroidered" } },
          customerHeaders
        )
        .catch((e: any) => e.response)
      expect(onKids.status).toBe(400)
      expect(onKids.data.message).toMatch(/not offered on this variant/)

      const cart = (await api.get(`/store/carts/${cartId}`, customerHeaders))
        .data.cart
      const pieceLines = cart.items.filter((i: any) => i.variant_id === apron.id)
      const setupLines = cart.items.filter(
        (i: any) => i.metadata?.made_to_spec_setup_fee
      )

      expect(pieceLines.length).toBeGreaterThan(0)
      for (const line of pieceLines) {
        expect(Number(line.unit_price)).toBe(41.5)
        expect(line.metadata.made_to_spec.pricing).toMatchObject({
          base_unit_price: 40,
          surcharge_per_piece: 1.5,
        })
      }
      expect(
        pieceLines.reduce((n: number, l: any) => n + Number(l.quantity), 0)
      ).toBe(6)

      expect(setupLines).toHaveLength(1)
      expect(Number(setupLines[0].unit_price)).toBe(5)
      expect(Number(setupLines[0].quantity)).toBe(1)
      expect(setupLines[0].metadata.made_to_spec_setup_fee).toMatchObject({
        product_id: product.id,
        key: "logo",
        value: "My logo embroidered",
        payee: "supplier",
      })

      // A free choice keeps the variant's own price, untouched.
      expect(
        (
          await api.post(
            `/store/carts/${cartId}/made-to-spec`,
            { variant_id: apron.id, options: { logo: "No logo" } },
            customerHeaders
          )
        ).status
      ).toBe(200)
      const after = (await api.get(`/store/carts/${cartId}`, customerHeaders))
        .data.cart
      const free = after.items.find(
        (i: any) =>
          i.variant_id === apron.id &&
          i.metadata?.made_to_spec?.options?.[0]?.value === "No logo"
      )
      expect(Number(free.unit_price)).toBe(40)
      expect(free.is_custom_price).toBeFalsy()
    })
  })
})
