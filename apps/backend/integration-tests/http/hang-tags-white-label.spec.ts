import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(300 * 1000)

/**
 * #2541 — white-label hang tags. The tag's story is built from real records
 * (fabric supplier from the purchase order, maker from the design roster,
 * each partner's place from its warehouse and lead from its owner admin);
 * brand profiles are saved and laid over the default config; an order lists
 * one tag per piece.
 */
setupSharedTestSuite(() => {
  describe("White-label hang tags (#2541)", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: any
    let productId: string
    let orderId: string

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const link = container.resolve(ContainerRegistrationKeys.LINK) as any
      const partners: any = container.resolve(PARTNER_MODULE)
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

      const location = async (name: string, city: string, province: string) =>
        (
          await api.post(
            "/admin/stock-locations",
            { name, address: { address_1: "1 Loom Lane", city, province, country_code: "in" } },
            adminHeaders
          )
        ).data.stock_location.id as string

      const partnerWith = async (name: string, lead: [string, string], city: string, province: string) => {
        const p = await partners.createPartners({ name, handle: `${name.toLowerCase().replace(/\W+/g, "-")}-${unique}` })
        await partners.createPartnerAdmins({
          partner_id: p.id,
          email: `${p.handle}@tags.test`,
          first_name: lead[0],
          last_name: lead[1],
          role: "owner",
        })
        const loc = await location(`${name} WH`, city, province)
        await link.create({
          [PARTNER_MODULE]: { partner_id: p.id },
          [Modules.STOCK_LOCATION]: { stock_location_id: loc },
        })
        return p
      }

      const mill = await partnerWith("GOF Asia", ["Rahul", "Ghosh"], "Islampur", "West Bengal")
      const tailor = await partnerWith("Ksaman Naturals", ["Geetanjali", "Sharma"], "Bhubaneswar", "Odisha")

      // Fabric: an inventory item carrying a raw material with its technique
      const item = (
        await api.post("/admin/inventory-items", { title: "Kala Cotton Red" }, adminHeaders)
      ).data.inventory_item.id
      const rm = await (container.resolve("raw_materials") as any).createRawMaterials({
        name: "33s Kala Cotton",
        composition: "100% Kala Cotton",
        color: "Red",
        unit_of_measure: "Meter",
        status: "Active",
        specifications: { technique: "HandSpun + HandWoven" },
      })
      await link.create({
        [Modules.INVENTORY]: { inventory_item_id: item },
        raw_materials: { raw_materials_id: rm.id },
      })

      // Design with that fabric and a stitching partner on its roster
      const designId = (
        await api.post(
          "/admin/designs",
          { name: "Tea Towel", design_type: "Original", status: "Approved", priority: "Medium" },
          adminHeaders
        )
      ).data.design.id
      const wh = await location("Our WH", "Dharamshala", "Himachal Pradesh")
      await api.post(
        `/admin/designs/${designId}/inventory`,
        { inventoryItems: [{ inventoryId: item, plannedQuantity: 1, locationId: wh }] },
        adminHeaders
      )
      await api.post(
        `/admin/designs/${designId}/partner`,
        { partners: [{ partner_id: tailor.id, stage_role: "stitching" }] },
        adminHeaders
      )

      // The purchase order that bought the fabric names its supplier
      const po = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [{ inventory_item_id: item, quantity: 5, price: 285 }],
          quantity: 5,
          total_price: 1425,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: { first_name: "JYT", address_1: "1 Loom Lane", city: "Bhubaneswar", country_code: "in" },
          stock_location_id: wh,
        },
        adminHeaders
      )
      const poId = po.data.inventoryOrder?.id ?? po.data.inventory_order?.id
      await link.create({
        [PARTNER_MODULE]: { partner_id: mill.id },
        [ORDER_INVENTORY_MODULE]: { inventory_orders_id: poId },
      })

      // Product for the design, and an order for 3 of it plus a custom line
      const [product] = await (container.resolve(Modules.PRODUCT) as any).createProducts([
        { title: "Cotton Tea Towel", handle: `tea-towel-${unique}`, status: "published" },
      ])
      productId = product.id
      await link.create({
        [Modules.PRODUCT]: { product_id: productId },
        [DESIGN_MODULE]: { design_id: designId },
      })
      const order = await (container.resolve(Modules.ORDER) as any).createOrders({
        currency_code: "inr",
        email: `tags-${unique}@tags.test`,
        status: "pending",
        items: [
          {
            title: "Cotton Tea Towel",
            product_id: productId,
            product_handle: product.handle,
            variant_title: "Kala Cotton, red",
            quantity: 3,
            unit_price: 500,
          },
          { title: "Alteration", quantity: 1, unit_price: 100 },
        ],
      })
      orderId = order.id
    })

    it("tells the tag story from the purchase order, the roster, warehouses and owners", async () => {
      const res = await api.get(`/admin/products/${productId}/hang-tag`, adminHeaders)
      expect(res.status).toBe(200)
      const story = res.data.product.story
      expect(story).not.toBeNull()
      expect(story.text).toBe(
        "This began in Islampur, West Bengal, where Rahul Ghosh and the GOF Asia team spin and weave cloth by hand. " +
          "The cloth then travelled to Bhubaneswar, Odisha, where Geetanjali Sharma and the Ksaman Naturals team cut and stitched it."
      )
      expect(story.fabrics).toEqual([
        expect.objectContaining({
          name: "33s Kala Cotton",
          composition: "100% Kala Cotton",
          technique: "HandSpun + HandWoven",
          supplier: expect.objectContaining({ name: "GOF Asia", lead: "Rahul Ghosh", place: "Islampur, West Bengal" }),
        }),
      ])
      // Printed for customers: nothing commercial on it.
      expect(JSON.stringify(story)).not.toMatch(/price|cost|tax_id/)
    })

    it("lists one tag per piece in an order, and says which lines get none", async () => {
      const res = await api.get(`/admin/orders/${orderId}/hang-tags`, adminHeaders)
      expect(res.status).toBe(200)
      expect(res.data.tag_count).toBe(3)
      expect(res.data.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ product_id: productId, variant_title: "Kala Cotton, red", quantity: 3 }),
          expect.objectContaining({ product_id: null, title: "Alteration", quantity: 1 }),
        ])
      )
      const missing = await api.get(`/admin/orders/order_missing/hang-tags`, adminHeaders).catch((e) => e.response)
      expect(missing.status).toBe(404)
    })

    it("saves brand profiles with white-label defaults, merges edits, deletes", async () => {
      const bad = await api
        .post("/admin/hang-tag-settings/brands", { config: { tagline: "x" } }, adminHeaders)
        .catch((e) => e.response)
      expect(bad.status).toBe(400)

      const created = await api.post(
        "/admin/hang-tag-settings/brands",
        { config: { brand_name: "Oshen", logo_url: "https://example.com/oshen.jpg" } },
        adminHeaders
      )
      expect(created.status).toBe(201)
      const brand = created.data.brand
      // Our QR opens OUR storefront, and the design name is internal: both off.
      expect(brand.config).toMatchObject({
        brand_name: "Oshen",
        show_story: true,
        show_care: true,
        show_mrp: true,
        show_qr_code: false,
        show_design_info: false,
      })

      const updated = await api.put(
        `/admin/hang-tag-settings/brands/${brand.id}`,
        { config: { care_text: "Hand wash cold." } },
        adminHeaders
      )
      expect(updated.data.brand.config).toMatchObject({ brand_name: "Oshen", care_text: "Hand wash cold." })

      const list = await api.get("/admin/hang-tag-settings/brands", adminHeaders)
      expect(list.data.brands.map((b: any) => b.id)).toContain(brand.id)

      // A brand is not the default config: the default stays ours.
      const def = await api.get("/admin/hang-tag-settings", adminHeaders)
      expect(def.data.config.brand_name).not.toBe("Oshen")

      await api.delete(`/admin/hang-tag-settings/brands/${brand.id}`, adminHeaders)
      const gone = await api
        .get(`/admin/hang-tag-settings/brands/${brand.id}`, adminHeaders)
        .catch((e) => e.response)
      expect(gone.status).toBe(404)
    })
  })
})
