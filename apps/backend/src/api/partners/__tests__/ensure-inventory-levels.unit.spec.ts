import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import { ensureInventoryLevelsForVariants } from "../helpers"

/**
 * The N+1 in the inventory-level seeder.
 *
 * It used to call `listInventoryLevels({ inventory_item_id: itemId })` once per
 * item, sequentially, before writing anything — so a partner saving N variants
 * paid N round trips, and the create-product path calls this with every variant
 * on the product at once. The query-count assertions below are the fix; the
 * behavioural ones pin that batching did not change what gets written.
 */

const makeScope = (opts: {
  locationIds: string[]
  variants: any[]
  existingLevels: any[]
}) => {
  const calls = { listInventoryLevels: 0, createInventoryLevels: 0 }
  const created: any[] = []
  const listFilters: any[] = []

  const inventoryService = {
    listInventoryLevels: async (filter: any) => {
      calls.listInventoryLevels++
      listFilters.push(filter)
      const wanted = Array.isArray(filter.inventory_item_id)
        ? filter.inventory_item_id
        : [filter.inventory_item_id]
      return opts.existingLevels.filter((l) =>
        wanted.includes(l.inventory_item_id)
      )
    },
    createInventoryLevels: async (rows: any[]) => {
      calls.createInventoryLevels++
      created.push(...rows)
      return rows
    },
  }

  const query = {
    graph: async ({ entity }: any) => {
      if (entity === "sales_channels") {
        return {
          data: [{ stock_locations: opts.locationIds.map((id) => ({ id })) }],
        }
      }
      return { data: opts.variants }
    },
  }

  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === Modules.INVENTORY) return inventoryService
      throw new Error(`unexpected resolve(${String(key)})`)
    },
  }

  return { scope, calls, created, listFilters }
}

const managedVariant = (n: number) => ({
  manage_inventory: true,
  inventory_items: [{ inventory: { id: `iitem_${n}` } }],
})

describe("ensureInventoryLevelsForVariants", () => {
  it("makes ONE listInventoryLevels call regardless of variant count", async () => {
    const { scope, calls } = makeScope({
      locationIds: ["sloc_1"],
      variants: Array.from({ length: 25 }, (_, i) => managedVariant(i)),
      existingLevels: [],
    })

    await ensureInventoryLevelsForVariants(
      scope as any,
      { id: "store_1", default_sales_channel_id: "sc_1" },
      Array.from({ length: 25 }, (_, i) => `variant_${i}`)
    )

    // Was 25 before — one per item, sequential.
    expect(calls.listInventoryLevels).toBe(1)
  })

  it("passes every item id in a single array filter", async () => {
    const { scope, listFilters } = makeScope({
      locationIds: ["sloc_1"],
      variants: [managedVariant(0), managedVariant(1), managedVariant(2)],
      existingLevels: [],
    })

    await ensureInventoryLevelsForVariants(
      scope as any,
      { id: "store_1", default_sales_channel_id: "sc_1" },
      ["v0", "v1", "v2"]
    )

    expect(listFilters).toHaveLength(1)
    expect(listFilters[0].inventory_item_id).toEqual([
      "iitem_0",
      "iitem_1",
      "iitem_2",
    ])
  })

  it("still seeds a level per item per location", async () => {
    const { scope, created } = makeScope({
      locationIds: ["sloc_1", "sloc_2"],
      variants: [managedVariant(0), managedVariant(1)],
      existingLevels: [],
    })

    await ensureInventoryLevelsForVariants(
      scope as any,
      { id: "store_1", default_sales_channel_id: "sc_1" },
      ["v0", "v1"]
    )

    expect(created).toHaveLength(4)
    expect(created.every((r) => r.stocked_quantity === 0)).toBe(true)
  })

  it("does NOT duplicate a level that already exists — per item, not globally", async () => {
    // The batching bug to avoid: attributing one item's existing levels to all
    // items. iitem_0 already has sloc_1; iitem_1 has nothing.
    const { scope, created } = makeScope({
      locationIds: ["sloc_1"],
      variants: [managedVariant(0), managedVariant(1)],
      existingLevels: [
        { inventory_item_id: "iitem_0", location_id: "sloc_1" },
      ],
    })

    await ensureInventoryLevelsForVariants(
      scope as any,
      { id: "store_1", default_sales_channel_id: "sc_1" },
      ["v0", "v1"]
    )

    expect(created).toEqual([
      { inventory_item_id: "iitem_1", location_id: "sloc_1", stocked_quantity: 0 },
    ])
  })

  it("skips variants that do not manage inventory", async () => {
    const { scope, created, calls } = makeScope({
      locationIds: ["sloc_1"],
      variants: [{ manage_inventory: false, inventory_items: [] }],
      existingLevels: [],
    })

    await ensureInventoryLevelsForVariants(
      scope as any,
      { id: "store_1", default_sales_channel_id: "sc_1" },
      ["v0"]
    )

    expect(created).toHaveLength(0)
    expect(calls.listInventoryLevels).toBe(0)
  })

  it("no-ops without variants or a default sales channel", async () => {
    const { scope, calls } = makeScope({
      locationIds: ["sloc_1"],
      variants: [managedVariant(0)],
      existingLevels: [],
    })

    await ensureInventoryLevelsForVariants(
      scope as any,
      { id: "store_1", default_sales_channel_id: null },
      ["v0"]
    )
    await ensureInventoryLevelsForVariants(
      scope as any,
      { id: "store_1", default_sales_channel_id: "sc_1" },
      []
    )

    expect(calls.listInventoryLevels).toBe(0)
  })
})
