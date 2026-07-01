import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { RAW_MATERIAL_MODULE } from "../../src/modules/raw_material"

jest.setTimeout(90000)

/**
 * #817 S3 — group-ordering API: create a raw_material_group, add per-color
 * raw_materials, order the group in multiple colors (fanning out one line per
 * color), and auto-create the per-color inventory_item when a color has none.
 */
setupSharedTestSuite(() => {
  let headers: any
  let stockLocationId: string
  const { api, getContainer } = getSharedTestEnv()

  const orderFields = (lines: any[]) => ({
    lines,
    status: "Pending",
    order_date: "2026-07-01T00:00:00.000Z",
    expected_delivery_date: "2026-08-01T00:00:00.000Z",
    shipping_address: { city: "Delhi", country_code: "in" },
    stock_location_id: stockLocationId,
    is_sample: false,
  })

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    const stockLocation = await api.post(
      "/admin/stock-locations",
      { name: "Group Order Warehouse" },
      headers
    )
    stockLocationId = stockLocation.data.stock_location.id
  })

  it("creates a group with enum defaults", async () => {
    const res = await api.post(
      "/admin/raw-material-groups",
      { name: "Cotton Poplin", composition: "100% Cotton" },
      headers
    )
    expect(res.status).toBe(201)
    expect(res.data.raw_material_group.id).toBeTruthy()
    expect(res.data.raw_material_group.status).toBe("Active")
    expect(res.data.raw_material_group.unit_of_measure).toBe("Other")
  })

  it("adds colors and returns them (with their inventory_item + sku) on the group", async () => {
    const { data: { raw_material_group: group } } = await api.post(
      "/admin/raw-material-groups",
      { name: "Linen Blend", composition: "80% Linen 20% Cotton", unit_of_measure: "Meter" },
      headers
    )

    const blue = await api.post(
      `/admin/raw-material-groups/${group.id}/colors`,
      { name: "Linen Blend — Blue", color: "Blue" },
      headers
    )
    expect(blue.status).toBe(201)
    await api.post(
      `/admin/raw-material-groups/${group.id}/colors`,
      { name: "Linen Blend — Red", color: "Red" },
      headers
    )

    const detail = await api.get(
      `/admin/raw-material-groups/${group.id}`,
      { headers: headers.headers }
    )
    expect(detail.status).toBe(200)
    const colors = detail.data.raw_material_group.raw_materials
    expect(colors).toHaveLength(2)
    const colorNames = colors.map((c: any) => c.color).sort()
    expect(colorNames).toEqual(["Blue", "Red"])
    // each color has an inventory_item with a generated SKU
    for (const c of colors) {
      expect(c.inventory_item?.id).toBeTruthy()
      expect(typeof c.inventory_item?.sku).toBe("string")
    }
  })

  it("orders a group in multiple colors — one line per color, color denormalized (S2)", async () => {
    const { data: { raw_material_group: group } } = await api.post(
      "/admin/raw-material-groups",
      { name: "Silk Charmeuse", composition: "100% Silk", unit_of_measure: "Meter" },
      headers
    )
    // two colors, each already backed by an inventory_item (via add-color)
    const ivory = (await api.post(
      `/admin/raw-material-groups/${group.id}/colors`,
      { name: "Silk — Ivory", color: "Ivory", material_type_id: undefined },
      headers
    ))
    const { data: detail } = await api.get(
      `/admin/raw-material-groups/${group.id}`,
      { headers: headers.headers }
    )
    // add a second color
    await api.post(
      `/admin/raw-material-groups/${group.id}/colors`,
      { name: "Silk — Black", color: "Black" },
      headers
    )
    const { data: detail2 } = await api.get(
      `/admin/raw-material-groups/${group.id}`,
      { headers: headers.headers }
    )
    const colors = detail2.raw_material_group.raw_materials

    const res = await api.post(
      `/admin/raw-material-groups/${group.id}/orders`,
      orderFields(colors.map((c: any, i: number) => ({
        raw_material_id: c.id,
        quantity: (i + 1) * 10,
        price: 5,
      }))),
      headers
    )

    expect(res.status).toBe(201)
    // no new items created — both colors already had one
    expect(res.data.created_inventory_item_ids).toHaveLength(0)
    const orderlines = res.data.inventoryOrder.orderlines
    expect(orderlines).toHaveLength(2)
    // S2 denormalization rode along: each line has its color + material_name
    const lineColors = orderlines.map((l: any) => l.color).sort()
    expect(lineColors).toEqual(["Black", "Ivory"])
    for (const l of orderlines) {
      expect(l.material_name).toBeTruthy()
      expect(l.raw_material_id).toBeTruthy()
    }
  })

  it("auto-creates the inventory_item for a color that has none", async () => {
    const service: any = getContainer().resolve(RAW_MATERIAL_MODULE)
    const group = await service.createRawMaterialGroups({
      name: "Wool Melton",
      composition: "100% Wool",
      unit_of_measure: "Meter",
    })
    // a color created directly on the module → NO inventory_item linked yet
    const orphanColor = await service.createRawMaterials({
      name: "Wool Melton — Charcoal",
      description: "no item yet",
      composition: "100% Wool",
      color: "Charcoal",
      group_id: group.id,
    })

    const res = await api.post(
      `/admin/raw-material-groups/${group.id}/orders`,
      orderFields([{ raw_material_id: orphanColor.id, quantity: 25, price: 7 }]),
      headers
    )

    expect(res.status).toBe(201)
    // the resolve step created exactly one item for the orphan color
    expect(res.data.created_inventory_item_ids).toHaveLength(1)
    const orderlines = res.data.inventoryOrder.orderlines
    expect(orderlines).toHaveLength(1)
    expect(orderlines[0].color).toBe("Charcoal")
    expect(orderlines[0].quantity).toBe(25)
  })

  it("rejects an empty color list", async () => {
    const { data: { raw_material_group: group } } = await api.post(
      "/admin/raw-material-groups",
      { name: "Empty Test" },
      headers
    )
    const res = await api
      .post(`/admin/raw-material-groups/${group.id}/orders`, orderFields([]), headers)
      .catch((e: any) => e.response)
    expect(res.status).toBe(400)
  })
})
