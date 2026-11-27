/**
 * #2659 — a partner proposes NEW cloth (and photos) on an assigned inventory
 * order from the mobile app; an admin sorts each new item, then approves.
 *
 * The real case: an order placed with 1 m / ₹0 placeholders because the weaver
 * had not counted yet. Pins:
 *   1. Stage: a `new_material` line (no id) + photos is staged with a server
 *      `key`; nothing is created — no inventory item, no line.
 *   2. Admin sorts: rename one new item, drop another, by key.
 *   3. Approve: the kept new item becomes a real inventory item (title, unit,
 *      thumbnail = first photo) on a new line; the dropped one is never
 *      created; photos on an existing line land on its metadata; totals are
 *      re-derived; no stock is posted.
 *   4. A partner cannot point a new line at an arbitrary existing item.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const PARTNER_PASSWORD = "supersecret"
const PHOTO_1 = "https://cdn.example.com/matty-1.jpg"
const PHOTO_2 = "https://cdn.example.com/matty-2.jpg"
const LINE_PHOTO = "https://cdn.example.com/beige-check.jpg"

// 120 s: the app boot alone ran past 60 s on CI (#2665 run 45957448762);
// the shared config default is 90 s and this spec must not lower it.
jest.setTimeout(120 * 1000)

async function registerPartner(api: any, email: string, handle: string) {
  await api.post("/auth/partner/emailpass/register", { email, password: PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
  const partnerRes = await api.post(
    "/partners",
    { name: handle, handle, admin: { email, first_name: "P", last_name: handle } },
    { headers: { Authorization: `Bearer ${login1.data.token}` } }
  )
  const login2 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
  return {
    partnerId: partnerRes.data.partner.id,
    headers: { Authorization: `Bearer ${login2.data.token}` },
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner proposes new items with photos (#2659)", () => {
    let adminHeaders: any
    let ownerHeaders: any
    let orderId: string
    let lineA: any
    let itemA: string
    let destinationId: string

    const readOrder = async (id: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id },
        fields: [
          "id",
          "quantity",
          "total_price",
          "orderlines.id",
          "orderlines.quantity",
          "orderlines.price",
          "orderlines.metadata",
          "orderlines.inventory_items.id",
          "orderlines.inventory_items.title",
          "orderlines.inventory_items.thumbnail",
          "orderlines.inventory_items.unit_of_measure",
          "orderlines.inventory_items.metadata",
        ],
      })
      return data?.[0]
    }

    const countItemsTitled = async (title: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_item",
        filters: { title },
        fields: ["id"],
      })
      return (data ?? []).length
    }

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const owner = await registerPartner(api, `weaver-${unique}@new-items.com`, `weaver-${unique}`)
      ownerHeaders = owner.headers

      const item = await api.post(
        "/admin/inventory-items",
        { title: `Beige check ${unique}`, sku: `beige-${unique}` },
        adminHeaders
      )
      itemA = item.data.inventory_item.id

      const to = await api.post("/admin/stock-locations", { name: `WH ${unique}` }, adminHeaders)
      const from = await api.post("/admin/stock-locations", { name: `Loom ${unique}` }, adminHeaders)
      destinationId = to.data.stock_location.id

      // The real shape: a placeholder line at 1 m / ₹0.
      const orderRes = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [{ inventory_item_id: itemA, quantity: 1, price: 0 }],
          quantity: 1,
          total_price: 0,
          status: "Pending",
          expected_delivery_date: new Date(Date.now() + 7 * 864e5).toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: destinationId,
          to_stock_location_id: destinationId,
          from_stock_location_id: from.data.stock_location.id,
          is_sample: false,
        },
        adminHeaders
      )
      expect(orderRes.status).toBe(201)
      orderId = orderRes.data.inventoryOrder.id
      lineA = orderRes.data.inventoryOrder.orderlines[0]

      const assign = await api.post(
        `/admin/inventory-orders/${orderId}/assign-partner`,
        { partner_id: owner.partnerId },
        adminHeaders
      )
      expect(assign.status).toBe(200)
    })

    it("stages new items with photos, admin renames one and drops one, approval creates only the kept item", async () => {
      const unique = orderId.slice(-6)
      const mattyName = `Matty Cotton ${unique}`
      const plainName = `Plain Weave ${unique}`
      const renamed = `Matty Cotton Fine ${unique}`

      const stage = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, quantity: 12.5, price: 180, photos: [LINE_PHOTO] },
            {
              new_material: { name: mattyName, color: "Natural", unit_of_measure: "Meter" },
              quantity: 20,
              price: 150,
              photos: [PHOTO_1, PHOTO_2],
            },
            {
              new_material: { name: plainName },
              quantity: 5,
              price: 100,
            },
          ],
        },
        { headers: ownerHeaders }
      )
      expect(stage.status).toBe(200)
      const change = stage.data.change
      expect(change.status).toBe("pending")
      const newLines = change.proposed_lines.filter((l: any) => !l.id)
      expect(newLines).toHaveLength(2)
      for (const l of newLines) {
        expect(l.key).toMatch(/^npl_/)
      }
      const mattyKey = newLines.find((l: any) => l.new_material.name === mattyName).key
      const plainKey = newLines.find((l: any) => l.new_material.name === plainName).key

      // Staging created nothing.
      const staged = await readOrder(orderId)
      expect(staged.orderlines).toHaveLength(1)
      expect(await countItemsTitled(`${mattyName} — Natural`)).toBe(0)

      // The partner can read their own proposal back, keys and photos included.
      const partnerView = await api.get(`/partners/inventory-orders/${orderId}`, {
        headers: ownerHeaders,
      })
      const pendingLines =
        partnerView.data.inventoryOrder?.pending_change?.proposed_lines ??
        partnerView.data.inventory_order?.pending_change?.proposed_lines
      expect(pendingLines.find((l: any) => l.key === mattyKey).photos).toEqual([PHOTO_1, PHOTO_2])

      // Admin sorts: rename Matty, drop Plain.
      const rename = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${change.id}/new-lines/${mattyKey}`,
        { new_material: { name: renamed } },
        adminHeaders
      )
      expect(rename.status).toBe(200)
      const drop = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${change.id}/new-lines/${plainKey}`,
        { drop: true },
        adminHeaders
      )
      expect(drop.status).toBe(200)
      expect(drop.data.change.proposed_lines.filter((l: any) => !l.id)).toHaveLength(1)

      const missing = await api
        .post(
          `/admin/inventory-orders/${orderId}/changes/${change.id}/new-lines/npl_nope`,
          { drop: true },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(missing.status).toBe(404)

      const approve = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${change.id}/approve`,
        {},
        adminHeaders
      )
      expect(approve.status).toBe(200)

      const after = await readOrder(orderId)
      expect(after.orderlines).toHaveLength(2)

      // The existing line: real quantity/price, and the photo on its metadata.
      const a = after.orderlines.find((l: any) => l.id === lineA.id)
      expect(Number(a.quantity)).toBe(12.5)
      expect(Number(a.price)).toBe(180)
      // A STRING, not an array: the shipped apps decode line metadata as a
      // string map and an array would break the whole order for them.
      expect(a.metadata?.photos).toBe(LINE_PHOTO)

      // The kept new item, created by approval, renamed by the admin.
      const created = after.orderlines.find((l: any) => l.id !== lineA.id)
      const item = created.inventory_items?.[0]
      expect(item?.title).toBe(`${renamed} — Natural`)
      expect(item?.unit_of_measure).toBe("Meter")
      expect(item?.thumbnail).toBe(PHOTO_1)
      expect(item?.metadata?.photos).toEqual([PHOTO_1, PHOTO_2])
      expect(Number(created.quantity)).toBe(20)

      // The dropped one never existed.
      expect(await countItemsTitled(plainName)).toBe(0)

      // Totals from the approved lines: 12.5*180 + 20*150 = 2250 + 3000.
      expect(Number(after.total_price)).toBe(5250)
      expect(Number(after.quantity)).toBe(32.5)

      // No stock posted for the new item at the destination.
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: levels } = await query.graph({
        entity: "inventory_level",
        filters: { inventory_item_id: item.id, location_id: destinationId },
        fields: ["stocked_quantity"],
      })
      expect(levels.reduce((s: number, l: any) => s + Number(l.stocked_quantity || 0), 0)).toBe(0)
    })

    it("refuses a new line that names an existing inventory item, and one with no new_material", async () => {
      const pointAtItem = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          {
            order_lines: [
              { id: lineA.id, quantity: 1, price: 0 },
              { inventory_item_id: itemA, quantity: 5, price: 10 },
            ],
          },
          { headers: ownerHeaders }
        )
        .catch((e: any) => e.response)
      expect(pointAtItem.status).toBe(400)

      const noName = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          { order_lines: [{ quantity: 5, price: 10 }] },
          { headers: ownerHeaders }
        )
        .catch((e: any) => e.response)
      expect(noName.status).toBe(400)

      const badPhoto = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          {
            order_lines: [
              { new_material: { name: "X" }, quantity: 5, price: 10, photos: ["file:///tmp/x.jpg"] },
            ],
          },
          { headers: ownerHeaders }
        )
        .catch((e: any) => e.response)
      expect(badPhoto.status).toBe(400)
    })

    it("admin attaches new items to a colour group (existing or new) and a product variant; approval writes the links", async () => {
      const unique = orderId.slice(-6)
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)

      // An existing colour group and a product variant to attach to.
      const explain = (e: any) => {
        throw new Error(`${e?.response?.status} ${JSON.stringify(e?.response?.data)}`)
      }
      const groupRes = await api
        .post("/admin/raw-material-groups", { name: `Kala Cotton ${unique}` }, adminHeaders)
        .catch(explain)
      const groupId = groupRes.data.raw_material_group.id
      const productRes = await api.post(
        "/admin/products",
        {
          title: `Robe ${unique}`,
          handle: `robe-${unique.toLowerCase()}`,
          options: [{ title: "Default", values: ["Default"] }],
          variants: [
            {
              title: "Default",
              options: { Default: "Default" },
              manage_inventory: false,
              prices: [{ amount: 1000, currency_code: "inr" }],
            },
          ],
        },
        adminHeaders
      ).catch(explain)
      expect(productRes.status).toBe(200)
      const variantId = productRes.data.product.variants[0].id

      const stage = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, quantity: 1, price: 0 },
            { new_material: { name: `Grouped ${unique}`, color: "Indigo" }, quantity: 4, price: 120 },
            { new_material: { name: `Fresh ${unique}`, unit_of_measure: "Meter" }, quantity: 2, price: 90 },
            { new_material: { name: `Plain ${unique}` }, quantity: 1, price: 50 },
          ],
        },
        { headers: ownerHeaders }
      ).catch(explain)
      expect(stage.status).toBe(200)
      const change = stage.data.change
      const keyOf = (name: string) =>
        change.proposed_lines.find((l: any) => l.new_material?.name === name).key

      // Existing group + variant (×2.5) on the first; a NEW group on the second.
      const a1 = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${change.id}/new-lines/${keyOf(`Grouped ${unique}`)}`,
        { attach: { raw_material_group_id: groupId, variant_id: variantId, required_quantity: 2.5 } },
        adminHeaders
      ).catch(explain)
      expect(a1.status).toBe(200)
      const a2 = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${change.id}/new-lines/${keyOf(`Fresh ${unique}`)}`,
        { attach: { new_group_name: `Fresh Group ${unique}` } },
        adminHeaders
      ).catch(explain)
      expect(a2.status).toBe(200)

      // A target that does not exist is refused while the admin is looking.
      const bad = await api
        .post(
          `/admin/inventory-orders/${orderId}/changes/${change.id}/new-lines/${keyOf(`Plain ${unique}`)}`,
          { attach: { variant_id: "variant_does_not_exist" } },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(bad.status).toBe(404)

      const approve = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${change.id}/approve`,
        {},
        adminHeaders
      ).catch(explain)
      expect(approve.status).toBe(200)

      // Read the rows back.
      const after = await readOrder(orderId)
      const itemByTitle = (t: string) =>
        after.orderlines.map((l: any) => l.inventory_items?.[0]).find((i: any) => i?.title === t)
      const grouped = itemByTitle(`Grouped ${unique} — Indigo`)
      const fresh = itemByTitle(`Fresh ${unique}`)
      const plain = itemByTitle(`Plain ${unique}`)
      expect(grouped && fresh && plain).toBeTruthy()

      const { data: items } = await query.graph({
        entity: "inventory_item",
        filters: { id: [grouped.id, fresh.id, plain.id] },
        fields: ["id", "raw_materials.id", "raw_materials.group_id"],
      })
      const groupOf = (id: string) => {
        const rms = items.find((i: any) => i.id === id)?.raw_materials
        const rm = Array.isArray(rms) ? rms[0] : rms
        return rm?.group_id ?? null
      }
      expect(groupOf(grouped.id)).toBe(groupId)
      const freshGroupId = groupOf(fresh.id)
      expect(freshGroupId).toBeTruthy()
      expect(freshGroupId).not.toBe(groupId)
      const { data: freshGroups } = await query.graph({
        entity: "raw_material_group",
        filters: { id: freshGroupId },
        fields: ["id", "name"],
      })
      expect(freshGroups[0].name).toBe(`Fresh Group ${unique}`)
      // No attach asked → none made.
      expect(groupOf(plain.id)).toBeNull()

      // The variant → inventory item link row, with its required quantity.
      const { data: variants } = await query.graph({
        entity: "product_variant",
        filters: { id: variantId },
        fields: ["id", "inventory_items.inventory_item_id", "inventory_items.required_quantity"],
      })
      const links = variants[0].inventory_items ?? []
      expect(links).toHaveLength(1)
      expect(links[0].inventory_item_id).toBe(grouped.id)
      expect(Number(links[0].required_quantity)).toBe(2.5)
    })

    it("existing-line photos fill a MISSING item picture (+ raw material media, photo_pending cleared) and never overwrite a chosen thumbnail", async () => {
      const unique = orderId.slice(-6).toLowerCase()
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const CHOSEN = "https://cdn.example.com/chosen.jpg"
      const OLD_MEDIA = "https://cdn.example.com/old-swatch.jpg"
      const P1 = "https://cdn.example.com/partner-beige.jpg"
      const P2 = "https://cdn.example.com/partner-matty-1.jpg"
      const P3 = "https://cdn.example.com/partner-matty-2.jpg"

      // Admin adds "Matty Cotton" the real way (item + raw material, no picture),
      // flagged photo_pending like the prod rows.
      const addLine = await api.put(
        `/admin/inventory-orders/${orderId}/order-lines`,
        {
          data: { quantity: 2, total_price: 0 },
          order_lines: [
            { id: lineA.id, inventory_item_id: itemA, quantity: 1, price: 0 },
            { new_material: { name: `Matty Cotton ${unique}`, unit_of_measure: "Meter" }, quantity: 1, price: 0 },
          ],
        },
        adminHeaders
      )
      expect(addLine.status).toBe(200)
      const before = await readOrder(orderId)
      const mattyLine = before.orderlines.find((l: any) => l.id !== lineA.id)
      const mattyItemId = mattyLine.inventory_items[0].id

      const inventory: any = container.resolve("inventory")
      await inventory.updateInventoryItems({
        id: mattyItemId,
        metadata: { photo_pending: true, supplier_partner_id: "keep-me" },
      })
      const { data: rmRows } = await query.graph({
        entity: "inventory_item",
        filters: { id: mattyItemId },
        fields: ["raw_materials.id"],
      })
      const rmsBefore = rmRows[0].raw_materials
      const rawMaterialId = (Array.isArray(rmsBefore) ? rmsBefore[0] : rmsBefore).id
      const rawMaterials: any = container.resolve("raw_materials")
      await rawMaterials.updateRawMaterials([{ id: rawMaterialId, media: { files: [OLD_MEDIA] } }])

      // The beige item already has a picture somebody chose.
      await inventory.updateInventoryItems({ id: itemA, thumbnail: CHOSEN })

      const stage = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, quantity: 3, price: 10, photos: [P1] },
            { id: mattyLine.id, quantity: 12, price: 150, photos: [P2, P3] },
          ],
        },
        { headers: ownerHeaders }
      )
      expect(stage.status).toBe(200)
      const approve = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${stage.data.change.id}/approve`,
        {},
        adminHeaders
      )
      expect(approve.status).toBe(200)

      // Read the item rows back.
      const { data: items } = await query.graph({
        entity: "inventory_item",
        filters: { id: [itemA, mattyItemId] },
        fields: ["id", "thumbnail", "metadata", "raw_materials.id", "raw_materials.media"],
      })
      const beige = items.find((i: any) => i.id === itemA)
      const matty = items.find((i: any) => i.id === mattyItemId)

      // Never overwrite a chosen thumbnail.
      expect(beige.thumbnail).toBe(CHOSEN)

      // A missing picture is filled from the first photo; photo_pending cleared,
      // other metadata kept.
      expect(matty.thumbnail).toBe(P2)
      expect(matty.metadata?.photo_pending).toBeUndefined()
      expect(matty.metadata?.supplier_partner_id).toBe("keep-me")

      // Raw material media keeps what it had and gains every photo.
      const rm = Array.isArray(matty.raw_materials) ? matty.raw_materials[0] : matty.raw_materials
      expect(rm.media).toEqual({ files: [OLD_MEDIA, P2, P3] })

      // The line metadata is unchanged in shape: one newline-joined string.
      const after = await readOrder(orderId)
      expect(after.orderlines.find((l: any) => l.id === mattyLine.id).metadata?.photos).toBe(`${P2}\n${P3}`)
    })

    it("lets a partner replace the only listed cloth with new ones (not an emptying)", async () => {
      const stage = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, remove: true },
            { new_material: { name: `Swap ${orderId.slice(-6)}` }, quantity: 3, price: 90 },
          ],
        },
        { headers: ownerHeaders }
      )
      expect(stage.status).toBe(200)
    })
  })
})
