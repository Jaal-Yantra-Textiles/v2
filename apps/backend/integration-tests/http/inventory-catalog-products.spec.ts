import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(90 * 1000)

/**
 * #1662 — an inventory order can only contain raw materials.
 *
 * The write path is already generic: `create-inventory-orders` takes a plain
 * `inventory_item_id`. The entire restriction lives in the picker's catalog
 * query, `getAllInventoryWithRawMaterial`, whose `query.graph` ENTRY POINT is
 * the raw-material link table — so a variant-backed inventory item cannot be
 * emitted by it under any filter. On production that hides ~78 of 225 items.
 *
 * These cases pin both halves:
 *
 *   1. the gate itself — the raw-materials route omits a product-backed item,
 *      which is why "just filter it" is not a fix (#1621's shape); and
 *   2. the new catalog route returns BOTH kinds, tagged, from one enumeration
 *      of `inventory_item`.
 *
 * The fixture creates the two kinds by their real paths — bulk-import for a
 * raw material, a managed-inventory product variant for a product — so the
 * linkage under test is the one production writes, not one the test asserts
 * into place.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("GET /admin/inventory-items/catalog (#1662)", () => {
    let headers: { headers: Record<string, string> }
    let stockLocationId: string
    let shippingProfileId: string

    const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)

      const loc = await api.post(
        "/admin/stock-locations",
        { name: `Catalog Warehouse ${unique()}` },
        headers
      )
      stockLocationId = loc.data.stock_location.id

      const profile = await api.post(
        "/admin/shipping-profiles",
        { name: `Catalog Profile ${unique()}`, type: "default" },
        headers
      )
      shippingProfileId = profile.data.shipping_profile.id
    })

    /** A raw-material-linked inventory item — what the picker can see today. */
    const seedRawMaterialItem = async (name: string) => {
      const imported = await api.post(
        "/admin/inventory-items/bulk-import",
        {
          items: [
            {
              name,
              composition: "100% Cotton",
              color: "Indigo",
              unit_of_measure: "Meter",
              material_type: "Cotton",
            },
          ],
          stock_location_id: stockLocationId,
        },
        headers
      )
      expect(imported.status).toBe(201)
      return imported.data.created[0].inventory_item.id as string
    }

    /**
     * A finished good: a product with a managed-inventory variant. Medusa's
     * create-variants flow makes the inventory item and the variant link — the
     * item has NO raw material behind it, which is exactly why the picker
     * cannot see it.
     */
    const seedProductItem = async (title: string, sku: string) => {
      const created = await api.post(
        "/admin/products",
        {
          title,
          status: "published",
          shipping_profile_id: shippingProfileId,
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            {
              title: "M",
              sku,
              manage_inventory: true,
              options: { Size: "M" },
              prices: [{ amount: 1200, currency_code: "inr" }],
            },
          ],
        },
        headers
      )
      expect(created.status).toBe(200)

      const productId = created.data.product.id
      const detail = await api.get(
        `/admin/products/${productId}?fields=variants.id,variants.sku,variants.inventory_items.inventory_item_id`,
        headers
      )
      const variant = detail.data.product.variants[0]
      const inventoryItemId = variant?.inventory_items?.[0]?.inventory_item_id
      expect(inventoryItemId).toBeTruthy()

      return {
        productId,
        variantId: variant.id as string,
        inventoryItemId: inventoryItemId as string,
      }
    }

    it("the raw-materials route cannot emit a product-backed item — the gate", async () => {
      const rawItemId = await seedRawMaterialItem(`Kala Cotton ${unique()}`)
      const { inventoryItemId } = await seedProductItem(
        `Finished Scarf ${unique()}`,
        `FIN-${unique()}`
      )

      const res = await api.get(
        "/admin/inventory-items/raw-materials?limit=1000",
        headers
      )
      expect(res.status).toBe(200)

      const emitted = res.data.inventory_items.map(
        (row: any) => row.inventory_item?.id ?? row.inventory_item_id
      )
      expect(emitted).toContain(rawItemId)
      // The whole of #1662 in one assertion.
      expect(emitted).not.toContain(inventoryItemId)
    })

    it("returns raw-material AND product-backed items, each tagged", async () => {
      const rawItemId = await seedRawMaterialItem(`Handloom Silk ${unique()}`)
      const { inventoryItemId, variantId } = await seedProductItem(
        `Finished Stole ${unique()}`,
        `FIN-${unique()}`
      )

      const res = await api.get(
        "/admin/inventory-items/catalog?limit=1000",
        headers
      )
      expect(res.status).toBe(200)

      const byId = new Map(
        res.data.inventory_items.map((r: any) => [r.id, r])
      )

      const rawRow: any = byId.get(rawItemId)
      expect(rawRow).toBeDefined()
      expect(rawRow.kind).toBe("raw_material")
      expect(rawRow.raw_materials?.id).toBeTruthy()

      const productRow: any = byId.get(inventoryItemId)
      expect(productRow).toBeDefined()
      expect(productRow.kind).toBe("product")
      expect(productRow.raw_materials).toBeNull()
      expect(productRow.variants.map((v: any) => v.id)).toContain(variantId)
      expect(productRow.variants[0].product?.title).toBeTruthy()

      // `scanned` is the whole catalog, so a narrow page can never read as a
      // small catalog (no silent caps).
      expect(res.data.scanned).toBeGreaterThanOrEqual(res.data.count)
    })

    it("searches product titles and skus, not just raw-material names", async () => {
      const marker = unique()
      const sku = `FIN-${marker}`
      const { inventoryItemId } = await seedProductItem(
        `Finished Throw ${marker}`,
        sku
      )

      const bySku = await api.get(
        `/admin/inventory-items/catalog?q=${encodeURIComponent(sku)}`,
        headers
      )
      expect(bySku.status).toBe(200)
      expect(bySku.data.inventory_items.map((r: any) => r.id)).toContain(
        inventoryItemId
      )

      const byTitle = await api.get(
        `/admin/inventory-items/catalog?q=${encodeURIComponent(
          `Finished Throw ${marker}`
        )}`,
        headers
      )
      expect(byTitle.data.inventory_items.map((r: any) => r.id)).toContain(
        inventoryItemId
      )
    })

    it("an inventory order accepts a product-backed line", async () => {
      const { inventoryItemId } = await seedProductItem(
        `Finished Dupatta ${unique()}`,
        `FIN-${unique()}`
      )

      const order = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 4, price: 900 },
          ],
          quantity: 4,
          total_price: 3600,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: stockLocationId,
        },
        headers
      )
      expect(order.status).toBe(201)

      const orderId = order.data.inventoryOrder.id
      // The item is a module LINK, not a column on the line (the line model's
      // "linking module links to order line with inventory and product"
      // comment is aspirational — only the inventory link exists).
      const detail = await api.get(
        `/admin/inventory-orders/${orderId}?fields=id,orderlines.*,orderlines.inventory_items.*`,
        headers
      )
      expect(detail.status).toBe(200)
      const lines = detail.data.inventoryOrder?.orderlines ?? []
      expect(lines.length).toBe(1)

      const linked = Array.isArray(lines[0].inventory_items)
        ? lines[0].inventory_items
        : [lines[0].inventory_items].filter(Boolean)
      expect(linked.map((i: any) => i?.id)).toContain(inventoryItemId)

      // #817's material denormalization is nullable and simply no-ops here.
      expect(lines[0].raw_material_id ?? null).toBeNull()
    })
  })
})
