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


    /**
     * The case #1662 actually exists for: a partner's fabric sold as a product
     * whose variants do NOT track inventory. Core creates no inventory item for
     * such a variant and can only ever turn tracking off — so there is nothing
     * for an `inventory_item` sweep to find. Seeded through the ordinary
     * product-create path, which is how these arrive in production.
     */
    const seedUntrackedVariantProduct = async (title: string, sku: string) => {
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
              manage_inventory: false,
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
        `/admin/products/${productId}?fields=variants.id,variants.sku,variants.manage_inventory,variants.inventory_items.inventory_item_id`,
        headers
      )
      const variant = detail.data.product.variants[0]
      // The premise of the whole slice: no item exists to be found.
      const links = variant?.inventory_items
      const existing = Array.isArray(links) ? links : [links].filter(Boolean)
      expect(
        existing.filter((l: any) => l?.inventory_item_id)
      ).toHaveLength(0)

      return { productId, variantId: variant.id as string }
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

    it("offers an untracked variant, which no inventory_item sweep could reach", async () => {
      const marker = unique()
      const { variantId } = await seedUntrackedVariantProduct(
        `Greige Fabric ${marker}`,
        `GRG-${marker}`
      )

      const res = await api.get(
        "/admin/inventory-items/catalog?limit=1000",
        headers
      )
      expect(res.status).toBe(200)

      const row = res.data.inventory_items.find(
        (r: any) => r.variant_id === variantId
      )
      expect(row).toBeDefined()
      expect(row.kind).toBe("untracked_variant")
      // It cannot be posted as an item, because there is no item.
      expect(row.inventory_item_id).toBeNull()
      expect(row.id).toBe(`untracked_variant:${variantId}`)
    })

    it("ordering an untracked variant creates its inventory item and links the line", async () => {
      const marker = unique()
      const { variantId } = await seedUntrackedVariantProduct(
        `Partner Greige ${marker}`,
        `PGR-${marker}`
      )

      const order = await api.post(
        "/admin/inventory-orders",
        {
          // The line names the VARIANT — there is no item id to name yet.
          order_lines: [{ variant_id: variantId, quantity: 40, price: 120 }],
          quantity: 40,
          total_price: 4800,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: stockLocationId,
        },
        headers
      )
      expect(order.status).toBe(201)

      // The variant is tracked now, and has the item core would not create.
      const detail = await api.get(
        `/admin/products?fields=variants.id,variants.manage_inventory,variants.inventory_items.inventory_item_id&limit=1000`,
        headers
      )
      const variant = detail.data.products
        .flatMap((p: any) => p.variants ?? [])
        .find((v: any) => v.id === variantId)
      expect(variant.manage_inventory).toBe(true)

      const links = Array.isArray(variant.inventory_items)
        ? variant.inventory_items
        : [variant.inventory_items].filter(Boolean)
      const itemId = links.find((l: any) => l?.inventory_item_id)
        ?.inventory_item_id
      expect(itemId).toBeTruthy()

      // And the order line points at that same item, not at nothing.
      const orderId = order.data.inventoryOrder.id
      const orderDetail = await api.get(
        `/admin/inventory-orders/${orderId}?fields=id,orderlines.*,orderlines.inventory_items.*`,
        headers
      )
      const lines = orderDetail.data.inventoryOrder?.orderlines ?? []
      expect(lines.length).toBe(1)
      const linked = Array.isArray(lines[0].inventory_items)
        ? lines[0].inventory_items
        : [lines[0].inventory_items].filter(Boolean)
      expect(linked.map((i: any) => i?.id)).toContain(itemId)

      // The order DETAIL page names the line from product + variant, because a
      // variant-made item's own title is just the variant's ("M", "Red"). That
      // label rides on a three-hop traversal, and `query.graph` DROPS a
      // relation it does not recognise in silence — so the hop is pinned here
      // rather than trusted.
      const withVariants = await api.get(
        `/admin/inventory-orders/${orderId}?fields=id,orderlines.*,orderlines.inventory_items.*,orderlines.inventory_items.variants.id,orderlines.inventory_items.variants.title,orderlines.inventory_items.variants.product.id,orderlines.inventory_items.variants.product.title`,
        headers
      )
      expect(withVariants.status).toBe(200)
      const detailLine = withVariants.data.inventoryOrder.orderlines[0]
      const detailItem = Array.isArray(detailLine.inventory_items)
        ? detailLine.inventory_items[0]
        : detailLine.inventory_items
      const detailVariant = (detailItem.variants ?? []).find((v: any) => v?.id)
      expect(detailVariant?.id).toBe(variantId)
      expect(detailVariant?.product?.title).toBe(`Partner Greige ${marker}`)

      // Nothing has been received, so the level at our location is 0 — the
      // order must not invent stock it has not taken delivery of.
      const levels = await api.get(
        `/admin/inventory-items/${itemId}/location-levels`,
        headers
      )
      expect(levels.status).toBe(200)
      const level = (levels.data.inventory_levels ?? []).find(
        (l: any) => l.location_id === stockLocationId
      )
      expect(Number(level?.stocked_quantity ?? 0)).toBe(0)

      // Once tracked, it is an ordinary catalog row — not offered twice.
      const after = await api.get(
        "/admin/inventory-items/catalog?limit=1000",
        headers
      )
      const rowsForVariant = after.data.inventory_items.filter(
        (r: any) =>
          r.variant_id === variantId ||
          (r.variants ?? []).some((v: any) => v.id === variantId)
      )
      expect(rowsForVariant).toHaveLength(1)
      expect(rowsForVariant[0].kind).toBe("product")
    })

    it("refuses a line that names both an item and a variant", async () => {
      const marker = unique()
      const { variantId } = await seedUntrackedVariantProduct(
        `Ambiguous Fabric ${marker}`,
        `AMB-${marker}`
      )
      const { inventoryItemId } = await seedProductItem(
        `Other Good ${marker}`,
        `OTH-${marker}`
      )

      const res = await api
        .post(
          "/admin/inventory-orders",
          {
            order_lines: [
              {
                inventory_item_id: inventoryItemId,
                variant_id: variantId,
                quantity: 1,
                price: 10,
              },
            ],
            quantity: 1,
            total_price: 10,
            status: "Pending",
            expected_delivery_date: new Date().toISOString(),
            order_date: new Date().toISOString(),
            shipping_address: {},
            stock_location_id: stockLocationId,
          },
          headers
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })
  })
})
