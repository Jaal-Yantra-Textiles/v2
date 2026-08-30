import { getInventoryCatalog } from "../helpers"

/**
 * #1662. The catalog's first sweep enumerates `inventory_item`, which can only
 * ever emit variants that ALREADY have one. The behaviours pinned here are the
 * ones that would go wrong silently:
 *
 *  - an untracked variant appears at all (the fabric case: many variants, none
 *    tracked, and no filter on the old sweep could reach them);
 *  - it is judged on the ABSENCE OF AN ITEM, not on `manage_inventory` — a
 *    tracked-but-itemless variant is just as unorderable;
 *  - a variant that HAS an item is not emitted twice, once per source;
 *  - the untracked row carries `variant_id` and a null `inventory_item_id`, so
 *    the caller cannot post the synthetic display id as an item.
 */

const buildContainer = (opts: {
  items?: any[]
  products?: any[]
  partners?: any[]
  partnerThrows?: boolean
}) => {
  const graph = jest.fn(async ({ entity }: any) => {
    if (entity === "inventory_item") {
      return { data: opts.items ?? [] }
    }
    if (entity === "product") {
      return { data: opts.products ?? [] }
    }
    if (entity === "partner") {
      if (opts.partnerThrows) {
        throw new Error("partner link unavailable")
      }
      return { data: opts.partners ?? [] }
    }
    return { data: [] }
  })

  return {
    resolve: (key: string) => (key === "query" ? { graph } : {}),
  } as any
}

const TRACKED_ITEM = {
  id: "iitem_1",
  title: "Tracked item",
  sku: "SKU-T",
  raw_materials: null,
  variants: [
    {
      id: "variant_tracked",
      title: "Blue",
      sku: "SKU-T",
      product: { id: "prod_1", title: "Fabric", thumbnail: null },
    },
  ],
}

const PRODUCT_WITH_MIXED_VARIANTS = {
  id: "prod_1",
  title: "Fabric",
  thumbnail: "thumb.png",
  variants: [
    {
      id: "variant_tracked",
      title: "Blue",
      sku: "SKU-T",
      manage_inventory: true,
      inventory_items: [
        { inventory_item_id: "iitem_1", inventory: { id: "iitem_1" } },
      ],
    },
    {
      id: "variant_untracked",
      title: "Red",
      sku: "SKU-U",
      manage_inventory: false,
      inventory_items: [],
    },
  ],
}

describe("getInventoryCatalog — the second source (#1662)", () => {
  it("emits a variant that has no inventory item, which the item sweep can never reach", async () => {
    const container = buildContainer({
      items: [TRACKED_ITEM],
      products: [PRODUCT_WITH_MIXED_VARIANTS],
    })

    const { rows } = await getInventoryCatalog(container)

    const untracked = rows.filter((r) => r.kind === "untracked_variant")
    expect(untracked).toHaveLength(1)
    expect(untracked[0].variant_id).toBe("variant_untracked")
    expect(untracked[0].sku).toBe("SKU-U")
  })

  it("does not emit a variant twice when it already has an item", async () => {
    const container = buildContainer({
      items: [TRACKED_ITEM],
      products: [PRODUCT_WITH_MIXED_VARIANTS],
    })

    const { rows } = await getInventoryCatalog(container)

    const forTracked = rows.filter(
      (r) =>
        r.variant_id === "variant_tracked" ||
        r.variants.some((v: any) => v.id === "variant_tracked")
    )
    expect(forTracked).toHaveLength(1)
    expect(forTracked[0].inventory_item_id).toBe("iitem_1")
  })

  it("judges on the missing item, not on manage_inventory — a tracked variant with no item is still offered", async () => {
    const container = buildContainer({
      items: [],
      products: [
        {
          id: "prod_2",
          title: "Greige",
          variants: [
            {
              id: "variant_tracked_no_item",
              title: "Natural",
              sku: "SKU-N",
              // The flag says tracked; there is still nothing to stock.
              manage_inventory: true,
              inventory_items: [],
            },
          ],
        },
      ],
    })

    const { rows } = await getInventoryCatalog(container)

    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe("untracked_variant")
    expect(rows[0].variant_id).toBe("variant_tracked_no_item")
  })

  it("gives an untracked row a synthetic id and a null inventory_item_id, so it cannot be posted as an item", async () => {
    const container = buildContainer({
      items: [],
      products: [PRODUCT_WITH_MIXED_VARIANTS],
    })

    const { rows } = await getInventoryCatalog(container)
    const row = rows.find((r) => r.variant_id === "variant_untracked")!

    expect(row.inventory_item_id).toBeNull()
    expect(row.id).toBe("untracked_variant:variant_untracked")
    expect(String(row.id).startsWith("iitem_")).toBe(false)
  })

  it("names the owning partner on both kinds of row, and matches a search on it", async () => {
    const container = buildContainer({
      items: [TRACKED_ITEM],
      products: [PRODUCT_WITH_MIXED_VARIANTS],
      partners: [
        { id: "partner_1", name: "Sharlho", products: [{ id: "prod_1" }] },
      ],
    })

    const { rows } = await getInventoryCatalog(container)
    expect(rows.every((r) => r.partner?.name === "Sharlho")).toBe(true)

    const { rows: searched } = await getInventoryCatalog(container, {
      q: "sharlho",
    })
    expect(searched).toHaveLength(rows.length)
  })

  it("still returns the catalog when partner ownership cannot be read", async () => {
    const container = buildContainer({
      items: [TRACKED_ITEM],
      products: [PRODUCT_WITH_MIXED_VARIANTS],
      partnerThrows: true,
    })

    const { rows } = await getInventoryCatalog(container)

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.partner === null)).toBe(true)
  })

  it("counts both sources in `scanned`, so a narrowed page never reads as a small catalog", async () => {
    const container = buildContainer({
      items: [TRACKED_ITEM],
      products: [PRODUCT_WITH_MIXED_VARIANTS],
    })

    const { rows, scanned } = await getInventoryCatalog(container, {
      kinds: ["untracked_variant"],
    })

    expect(rows).toHaveLength(1)
    expect(scanned).toBe(2)
  })
})
