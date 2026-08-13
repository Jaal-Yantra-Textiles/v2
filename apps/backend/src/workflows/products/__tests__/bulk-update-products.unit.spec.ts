import { bulkUpdateProducts } from "../bulk-update-products"

/**
 * The behaviours worth pinning here are the ones a reader would otherwise have
 * to take on trust, and the two that are outright counter-intuitive:
 *
 *  - `manage_inventory: false` is refused rather than forwarded (core would
 *    dismiss the inventory item and its levels).
 *  - an untracked variant gets an inventory item CREATED and LINKED, because
 *    core has no false → true path — the whole reason this file exists.
 */

const updateProductsWorkflow = jest.fn()
const updateProductVariantsWorkflow = jest.fn()
const createInventoryItemsWorkflow = jest.fn()
const batchInventoryItemLevelsWorkflow = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  updateProductsWorkflow: (...a: any[]) => updateProductsWorkflow(...a),
  updateProductVariantsWorkflow: (...a: any[]) =>
    updateProductVariantsWorkflow(...a),
  createInventoryItemsWorkflow: (...a: any[]) =>
    createInventoryItemsWorkflow(...a),
  batchInventoryItemLevelsWorkflow: (...a: any[]) =>
    batchInventoryItemLevelsWorkflow(...a),
}))

type Level = {
  inventory_item_id: string
  location_id: string
  stocked_quantity: number
  reserved_quantity?: number
}

const TRACKED_VARIANT = {
  id: "variant_tracked",
  title: "Tracked",
  sku: "SKU-T",
  manage_inventory: true,
  inventory_items: [{ inventory_item_id: "iitem_1", inventory: { id: "iitem_1" } }],
}

const UNTRACKED_VARIANT = {
  id: "variant_untracked",
  title: "Untracked",
  sku: "SKU-U",
  manage_inventory: false,
  inventory_items: [],
}

const buildContainer = (opts: {
  products?: any[]
  channelProductIds?: string[]
  locationIds?: string[]
  levels?: Level[]
}) => {
  const products = opts.products ?? []
  const levels = opts.levels ?? []
  const linkCreate = jest.fn().mockResolvedValue(undefined)

  const graph = jest.fn(async ({ entity, fields }: any) => {
    if (entity === "sales_channel") {
      return {
        data: [
          {
            id: "sc_1",
            products_link: (opts.channelProductIds ?? []).map((product_id) => ({
              product_id,
            })),
          },
        ],
      }
    }
    if (entity === "sales_channels") {
      return {
        data: [
          {
            stock_locations: (opts.locationIds ?? []).map((id) => ({ id })),
          },
        ],
      }
    }
    if (entity === "product") {
      // The id-only shape is the selector resolution pass.
      if (Array.isArray(fields) && fields.length === 1 && fields[0] === "id") {
        return { data: products.map((p) => ({ id: p.id })) }
      }
      return { data: products }
    }
    return { data: [] }
  })

  const inventoryService = {
    listInventoryLevels: jest.fn(
      async ({ inventory_item_id, location_id }: any) =>
        levels.filter(
          (l) =>
            l.inventory_item_id === inventory_item_id &&
            l.location_id === location_id
        )
    ),
  }

  const container: any = {
    resolve: (key: string) => {
      if (key === "query") return { graph }
      if (key === "link") return { create: linkCreate }
      if (key === "inventory") return inventoryService
      return {}
    },
  }

  return { container, graph, linkCreate, inventoryService }
}

beforeEach(() => {
  jest.clearAllMocks()
  updateProductsWorkflow.mockReturnValue({
    run: jest.fn().mockResolvedValue({ result: [] }),
  })
  updateProductVariantsWorkflow.mockReturnValue({
    run: jest.fn().mockResolvedValue({ result: [] }),
  })
  createInventoryItemsWorkflow.mockReturnValue({
    run: jest.fn().mockResolvedValue({ result: [{ id: "iitem_new" }] }),
  })
  batchInventoryItemLevelsWorkflow.mockReturnValue({
    run: jest.fn().mockResolvedValue({ result: {} }),
  })
})

describe("bulkUpdateProducts — refusals", () => {
  it("refuses manage_inventory: false without touching anything", async () => {
    const { container } = buildContainer({})

    const result = await bulkUpdateProducts(container, {
      selector: { all: true },
      variant_update: { manage_inventory: false },
    })

    expect(result.errors).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.warnings[0]).toMatch(/not accepted in bulk/i)
    // The refusal must come before any resolution, let alone any write.
    expect(updateProductVariantsWorkflow).not.toHaveBeenCalled()
    expect(batchInventoryItemLevelsWorkflow).not.toHaveBeenCalled()
  })

  it("caps the batch and writes nothing when a selector matches too many", async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      id: `prod_${i}`,
      title: `P${i}`,
      variants: [],
    }))
    const { container } = buildContainer({ products: many })

    const result = await bulkUpdateProducts(container, {
      selector: { all: true },
      set_inventory: { quantity: 0 },
    })

    expect(result.matched_products).toBe(201)
    expect(result.updated).toBe(0)
    expect(result.warnings.join(" ")).toMatch(/capped at 200/i)
    expect(batchInventoryItemLevelsWorkflow).not.toHaveBeenCalled()
  })
})

describe("bulkUpdateProducts — the false → true path core lacks", () => {
  const product = {
    id: "prod_1",
    title: "Shawl",
    shipping_profile: { id: "sp_1" },
    variants: [UNTRACKED_VARIANT],
  }

  it("creates an inventory item, links it, and seeds the level", async () => {
    const { container, linkCreate } = buildContainer({
      products: [product],
      locationIds: ["sloc_1"],
    })

    const result = await bulkUpdateProducts(container, {
      products: [{ product_id: "prod_1" }],
      set_inventory: { quantity: 12, ensure_managed: true, location_ids: ["sloc_1"] },
    })

    const variant = result.variants[0]
    expect(variant.status).toBe("ok")
    expect(variant.actions).toEqual(
      expect.arrayContaining([
        "enable_manage_inventory",
        "create_inventory_item",
        "link_inventory_item",
        "create_level",
      ])
    )

    // The flag flip is a real variant update...
    expect(updateProductVariantsWorkflow).toHaveBeenCalled()
    // ...and the link carries required_quantity, matching what core writes at
    // variant-create time. A link without it is not equivalent.
    expect(linkCreate).toHaveBeenCalledWith([
      expect.objectContaining({ data: { required_quantity: 1 } }),
    ])

    const levelInput =
      batchInventoryItemLevelsWorkflow.mock.results[0].value.run.mock.calls[0][0]
        .input
    expect(levelInput.create).toEqual([
      {
        inventory_item_id: "iitem_new",
        location_id: "sloc_1",
        stocked_quantity: 12,
      },
    ])
    expect(levelInput.update).toEqual([])
  })

  it("skips an untracked variant when ensure_managed is not asked for", async () => {
    const { container, linkCreate } = buildContainer({
      products: [product],
      locationIds: ["sloc_1"],
    })

    const result = await bulkUpdateProducts(container, {
      products: [{ product_id: "prod_1" }],
      set_inventory: { quantity: 12, location_ids: ["sloc_1"] },
    })

    expect(result.variants[0].status).toBe("skipped")
    expect(result.variants[0].reason).toMatch(/ensure_managed/)
    expect(linkCreate).not.toHaveBeenCalled()
    expect(createInventoryItemsWorkflow).not.toHaveBeenCalled()
  })
})

describe("bulkUpdateProducts — zeroing an existing level", () => {
  it("updates by (item, location) rather than by level id", async () => {
    const { container } = buildContainer({
      products: [
        { id: "prod_1", title: "Shawl", variants: [TRACKED_VARIANT] },
      ],
      locationIds: ["sloc_1"],
      levels: [
        {
          inventory_item_id: "iitem_1",
          location_id: "sloc_1",
          stocked_quantity: 40,
          reserved_quantity: 0,
        },
      ],
    })

    const result = await bulkUpdateProducts(container, {
      selector: { all: true },
      set_inventory: { quantity: 0, location_ids: ["sloc_1"] },
    })

    const levelInput =
      batchInventoryItemLevelsWorkflow.mock.results[0].value.run.mock.calls[0][0]
        .input
    // updateInventoryLevels keys on (inventory_item_id, location_id) and
    // IGNORES `id` — an update addressed by level id silently no-ops.
    expect(levelInput.update).toEqual([
      {
        inventory_item_id: "iitem_1",
        location_id: "sloc_1",
        stocked_quantity: 0,
      },
    ])
    expect(levelInput.create).toEqual([])
    expect(result.variants[0].inventory).toEqual([
      { location_id: "sloc_1", before: 40, after: 0, reserved: 0 },
    ])
  })

  it("warns when zeroing below stock already promised to orders", async () => {
    const { container } = buildContainer({
      products: [
        { id: "prod_1", title: "Shawl", variants: [TRACKED_VARIANT] },
      ],
      locationIds: ["sloc_1"],
      levels: [
        {
          inventory_item_id: "iitem_1",
          location_id: "sloc_1",
          stocked_quantity: 40,
          reserved_quantity: 3,
        },
      ],
    })

    const result = await bulkUpdateProducts(container, {
      selector: { all: true },
      set_inventory: { quantity: 0, location_ids: ["sloc_1"] },
    })

    expect(result.warnings.join(" ")).toMatch(/below their reserved quantity/i)
    // Warned, not blocked — the write still went out.
    expect(result.variants[0].status).toBe("ok")
    expect(batchInventoryItemLevelsWorkflow).toHaveBeenCalled()
  })
})

describe("bulkUpdateProducts — dry run", () => {
  it("reports the plan and writes nothing", async () => {
    const { container, linkCreate } = buildContainer({
      products: [
        {
          id: "prod_1",
          title: "Shawl",
          variants: [TRACKED_VARIANT, UNTRACKED_VARIANT],
        },
      ],
      locationIds: ["sloc_1"],
      levels: [
        {
          inventory_item_id: "iitem_1",
          location_id: "sloc_1",
          stocked_quantity: 40,
        },
      ],
    })

    const result = await bulkUpdateProducts(container, {
      selector: { all: true },
      set_inventory: { quantity: 0, ensure_managed: true, location_ids: ["sloc_1"] },
      dry_run: true,
    })

    expect(result.dry_run).toBe(true)
    expect(result.matched_variants).toBe(2)
    expect(result.variants.every((v) => v.status === "planned")).toBe(true)

    // The plan must show the tracked variant's real current quantity, and the
    // untracked one as having no level yet — that difference is the whole
    // point of reviewing a plan.
    const tracked = result.variants.find((v) => v.variant_id === "variant_tracked")!
    const untracked = result.variants.find(
      (v) => v.variant_id === "variant_untracked"
    )!
    expect(tracked.inventory?.[0]).toMatchObject({ before: 40, after: 0 })
    expect(untracked.inventory?.[0]).toMatchObject({ before: null, after: 0 })
    expect(untracked.actions).toEqual(
      expect.arrayContaining(["enable_manage_inventory", "create_inventory_item"])
    )

    expect(updateProductsWorkflow).not.toHaveBeenCalled()
    expect(updateProductVariantsWorkflow).not.toHaveBeenCalled()
    expect(createInventoryItemsWorkflow).not.toHaveBeenCalled()
    expect(batchInventoryItemLevelsWorkflow).not.toHaveBeenCalled()
    expect(linkCreate).not.toHaveBeenCalled()
  })

  it("flags products with no shipping profile when enabling tracking", async () => {
    const { container } = buildContainer({
      products: [
        { id: "prod_1", title: "Shawl", variants: [UNTRACKED_VARIANT] },
      ],
      locationIds: ["sloc_1"],
    })

    const result = await bulkUpdateProducts(container, {
      selector: { all: true },
      set_inventory: { quantity: 5, ensure_managed: true, location_ids: ["sloc_1"] },
      dry_run: true,
    })

    expect(result.warnings.join(" ")).toMatch(/no shipping profile/i)
    expect(result.warnings.join(" ")).toMatch(/requires_shipping/)
  })
})

describe("bulkUpdateProducts — partner scoping", () => {
  const products = [
    { id: "prod_mine", title: "Mine", variants: [TRACKED_VARIANT] },
  ]

  it("rejects a product outside the store's catalogue without failing the batch", async () => {
    const { container } = buildContainer({
      products,
      channelProductIds: ["prod_mine"],
      locationIds: ["sloc_mine"],
      levels: [
        {
          inventory_item_id: "iitem_1",
          location_id: "sloc_mine",
          stocked_quantity: 10,
        },
      ],
    })

    const result = await bulkUpdateProducts(
      container,
      {
        products: [{ product_id: "prod_mine" }, { product_id: "prod_theirs" }],
        set_inventory: { quantity: 0 },
      },
      { salesChannelId: "sc_1", allowedLocationIds: ["sloc_mine"] }
    )

    const foreign = result.products.find((p) => p.product_id === "prod_theirs")!
    expect(foreign.status).toBe("error")
    expect(foreign.reason).toMatch(/not part of your store/i)
    // The owned half still went through.
    expect(result.variants.some((v) => v.status === "ok")).toBe(true)
  })

  it("treats a store with no sales channel as owning nothing, not everything", async () => {
    const { container } = buildContainer({ products })

    const result = await bulkUpdateProducts(
      container,
      { selector: { all: true }, set_inventory: { quantity: 0 } },
      { salesChannelId: null }
    )

    expect(result.matched_products).toBe(0)
    expect(batchInventoryItemLevelsWorkflow).not.toHaveBeenCalled()
  })

  it("drops a stock location the caller may not write", async () => {
    const { container } = buildContainer({
      products,
      channelProductIds: ["prod_mine"],
      locationIds: ["sloc_mine"],
    })

    const result = await bulkUpdateProducts(
      container,
      {
        products: [{ product_id: "prod_mine" }],
        set_inventory: { quantity: 0, location_ids: ["sloc_someone_else"] },
      },
      { salesChannelId: "sc_1", allowedLocationIds: ["sloc_mine"] }
    )

    expect(result.warnings.join(" ")).toMatch(/may not write/i)
    // Falls back to the caller's own location rather than writing nothing.
    expect(result.variants[0].inventory?.[0].location_id).toBe("sloc_mine")
  })
})

describe("bulkUpdateProducts — field updates", () => {
  it("drops unknown columns instead of forwarding them", async () => {
    const { container } = buildContainer({
      products: [{ id: "prod_1", title: "Shawl", variants: [TRACKED_VARIANT] }],
    })

    await bulkUpdateProducts(container, {
      products: [{ product_id: "prod_1" }],
      product_update: { title: "New", not_a_column: "boom" },
    })

    const input =
      updateProductsWorkflow.mock.results[0].value.run.mock.calls[0][0].input
    expect(input.products[0]).toEqual({ id: "prod_1", title: "New" })
    expect(input.products[0]).not.toHaveProperty("not_a_column")
  })

  it("lets a per-product update override the blanket one", async () => {
    const { container } = buildContainer({
      products: [{ id: "prod_1", title: "Shawl", variants: [] }],
    })

    await bulkUpdateProducts(container, {
      products: [{ product_id: "prod_1", update: { status: "published" } }],
      product_update: { status: "draft" },
    })

    const input =
      updateProductsWorkflow.mock.results[0].value.run.mock.calls[0][0].input
    expect(input.products[0].status).toBe("published")
  })

  it("targets only the named variants when `variants` is given", async () => {
    const { container } = buildContainer({
      products: [
        {
          id: "prod_1",
          title: "Shawl",
          variants: [TRACKED_VARIANT, UNTRACKED_VARIANT],
        },
      ],
    })

    const result = await bulkUpdateProducts(container, {
      products: [
        {
          product_id: "prod_1",
          variants: [{ variant_id: "variant_tracked", update: { sku: "NEW" } }],
        },
      ],
    })

    expect(result.matched_variants).toBe(1)
    expect(result.variants[0].variant_id).toBe("variant_tracked")
  })
})
