import { ensureLineInventoryItems } from "../ensure-line-inventory-items"

const enableInventoryTracking = jest.fn()

jest.mock("../../../products/bulk-update-products", () => ({
  enableInventoryTracking: (...a: any[]) => enableInventoryTracking(...a),
}))

/**
 * #1662. What must hold before an order line is written:
 *
 *  - a line naming an untracked variant comes back naming a REAL item id;
 *  - a line that already names an item is left alone (no needless re-tracking);
 *  - a variant that cannot be given an item THROWS, rather than letting a line
 *    be written that links to nothing and reads as an ordinary order;
 *  - the level seeded at our location is 0 — the receipt posts the stock, and
 *    any other seed would be inventing goods we do not hold.
 */

const buildContainer = (opts: {
  products?: any[]
  levels?: any[]
  createLevels?: jest.Mock
}) => {
  const graph = jest.fn(async ({ entity }: any) =>
    entity === "product" ? { data: opts.products ?? [] } : { data: [] }
  )

  const inventoryService = {
    listInventoryLevels: jest.fn(async () => opts.levels ?? []),
    createInventoryLevels: opts.createLevels ?? jest.fn(async () => undefined),
  }

  return {
    resolve: (key: string) => {
      if (key === "query") return { graph }
      if (key === "inventory") return inventoryService
      return {}
    },
  } as any
}

const PRODUCT = {
  id: "prod_1",
  variants: [
    {
      id: "variant_untracked",
      sku: "SKU-U",
      title: "Red",
      manage_inventory: false,
      inventory_items: [],
    },
  ],
}

beforeEach(() => {
  enableInventoryTracking.mockReset()
})

describe("ensureLineInventoryItems (#1662)", () => {
  it("turns a variant reference into a real inventory item id", async () => {
    enableInventoryTracking.mockImplementation(
      async (_c: any, _v: any, actions: string[]) => {
        actions.push("enable_manage_inventory", "create_inventory_item")
        return "iitem_new"
      }
    )
    const container = buildContainer({ products: [PRODUCT] })

    const { lines, enabled_variant_ids } = await ensureLineInventoryItems(
      container,
      [{ variant_id: "variant_untracked", quantity: 3 } as any]
    )

    expect(lines[0].inventory_item_id).toBe("iitem_new")
    expect(enabled_variant_ids).toEqual(["variant_untracked"])
  })

  it("leaves a line that already names an item untouched", async () => {
    const container = buildContainer({ products: [] })

    const { lines, enabled_variant_ids } = await ensureLineInventoryItems(
      container,
      [{ inventory_item_id: "iitem_existing", quantity: 1 } as any]
    )

    expect(lines[0].inventory_item_id).toBe("iitem_existing")
    expect(enabled_variant_ids).toEqual([])
    expect(enableInventoryTracking).not.toHaveBeenCalled()
  })

  it("throws rather than writing a line that links to nothing", async () => {
    enableInventoryTracking.mockResolvedValue(null)
    const container = buildContainer({ products: [PRODUCT] })

    await expect(
      ensureLineInventoryItems(container, [
        { variant_id: "variant_untracked", quantity: 1 } as any,
      ])
    ).rejects.toThrow(/Could not establish an inventory item/)
  })

  it("throws when the variant does not exist at all", async () => {
    const container = buildContainer({ products: [] })

    await expect(
      ensureLineInventoryItems(container, [
        { variant_id: "variant_ghost", quantity: 1 } as any,
      ])
    ).rejects.toThrow(/does not exist/)
  })

  it("seeds the destination level at 0 — the receipt is what posts the stock", async () => {
    const createLevels = jest.fn(async () => undefined)
    enableInventoryTracking.mockImplementation(
      async (_c: any, _v: any, actions: string[]) => {
        actions.push("create_inventory_item")
        return "iitem_new"
      }
    )
    const container = buildContainer({
      products: [PRODUCT],
      levels: [],
      createLevels,
    })

    await ensureLineInventoryItems(
      container,
      [{ variant_id: "variant_untracked", quantity: 40 } as any],
      { stock_location_id: "sloc_ours" }
    )

    expect(createLevels).toHaveBeenCalledWith([
      {
        inventory_item_id: "iitem_new",
        location_id: "sloc_ours",
        stocked_quantity: 0,
      },
    ])
  })

  it("does not seed a level that already exists", async () => {
    const createLevels = jest.fn(async () => undefined)
    enableInventoryTracking.mockImplementation(
      async (_c: any, _v: any, actions: string[]) => {
        actions.push("create_inventory_item")
        return "iitem_new"
      }
    )
    const container = buildContainer({
      products: [PRODUCT],
      levels: [{ id: "ilev_1", stocked_quantity: 12 }],
      createLevels,
    })

    await ensureLineInventoryItems(
      container,
      [{ variant_id: "variant_untracked", quantity: 1 } as any],
      { stock_location_id: "sloc_ours" }
    )

    expect(createLevels).not.toHaveBeenCalled()
  })

  it("never coerces a missing reference into the string \"undefined\"", async () => {
    const container = buildContainer({ products: [] })

    const { lines } = await ensureLineInventoryItems(container, [
      { quantity: 1 } as any,
    ])

    expect(lines[0].inventory_item_id).toBeUndefined()
  })
})
