import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const updateVariantsRun = jest.fn().mockResolvedValue({ result: [] })
const updateProductsRun = jest.fn().mockResolvedValue({ result: [] })

jest.mock("@medusajs/medusa/core-flows", () => ({
  updateProductVariantsWorkflow: () => ({ run: updateVariantsRun }),
  updateProductsWorkflow: () => ({ run: updateProductsRun }),
}))

import {
  applyHsCodes,
  partitionAssignmentsByStore,
  scanMissingHsCodes,
} from "../hs-codes"

/**
 * The bulk HS-code apply is deliberately NOT transactional: one bad id in a
 * hundred-row batch must not throw away the ninety-nine good writes. These
 * tests pin that isolation, plus the two rules that protect a live customs
 * declaration — never clear a code, never write outside your own catalogue.
 */

const updateInventoryItems = jest.fn().mockResolvedValue([])

const makeContainer = (overrides: Record<string, any> = {}) =>
  ({
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) {
        return { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
      }
      if (key === Modules.INVENTORY) {
        return { updateInventoryItems }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return overrides.query
      }
      return undefined
    },
  }) as any

beforeEach(() => {
  updateVariantsRun.mockClear()
  updateProductsRun.mockClear()
  updateInventoryItems.mockClear()
})

describe("applyHsCodes", () => {
  it("routes each level to the module that owns it", async () => {
    const out = await applyHsCodes(makeContainer(), [
      { level: "variant", id: "var_1", hs_code: "6214" },
      { level: "product", id: "prod_1", hs_code: "6117" },
      { level: "inventory_item", id: "iitem_1", hs_code: "5208" },
    ])

    expect(out.applied).toBe(3)
    expect(out.errors).toBe(0)
    expect(updateVariantsRun).toHaveBeenCalledWith({
      input: { product_variants: [{ id: "var_1", hs_code: "6214" }] },
    })
    expect(updateProductsRun).toHaveBeenCalledWith({
      input: { products: [{ id: "prod_1", hs_code: "6117" }] },
    })
    expect(updateInventoryItems).toHaveBeenCalledWith([
      { id: "iitem_1", hs_code: "5208" },
    ])
  })

  it("carries origin_country and material through when supplied", async () => {
    await applyHsCodes(makeContainer(), [
      {
        level: "variant",
        id: "var_1",
        hs_code: "6214",
        origin_country: "IN",
        material: "Silk",
      },
    ])
    expect(updateVariantsRun).toHaveBeenCalledWith({
      input: {
        product_variants: [
          { id: "var_1", hs_code: "6214", origin_country: "IN", material: "Silk" },
        ],
      },
    })
  })

  it("isolates a failing row so the rest of the batch still lands", async () => {
    updateVariantsRun
      .mockRejectedValueOnce(new Error("Variant not found"))
      .mockResolvedValueOnce({ result: [] })

    const out = await applyHsCodes(makeContainer(), [
      { level: "variant", id: "var_missing", hs_code: "6214" },
      { level: "variant", id: "var_ok", hs_code: "6214" },
    ])

    expect(out.applied).toBe(1)
    expect(out.errors).toBe(1)
    expect(out.results[0]).toMatchObject({
      id: "var_missing",
      status: "error",
      reason: "Variant not found",
    })
    expect(out.results[1]).toMatchObject({ id: "var_ok", status: "applied" })
  })

  it("skips a blank code instead of clearing an existing one", async () => {
    // Wiping a code would break labels that currently work, and nothing in this
    // flow ever asks to remove one.
    const out = await applyHsCodes(makeContainer(), [
      { level: "variant", id: "var_1", hs_code: "   " },
    ])
    expect(out.skipped).toBe(1)
    expect(out.applied).toBe(0)
    expect(updateVariantsRun).not.toHaveBeenCalled()
  })

  it("errors on an unknown level or a missing id without touching anything", async () => {
    const out = await applyHsCodes(makeContainer(), [
      { level: "collection" as any, id: "x", hs_code: "6214" },
      { level: "variant", id: "", hs_code: "6214" },
    ])
    expect(out.errors).toBe(2)
    expect(updateVariantsRun).not.toHaveBeenCalled()
    expect(out.results[0].reason).toMatch(/Unknown level/)
    expect(out.results[1].reason).toMatch(/Missing id/)
  })

  it("handles an empty or nullish batch", async () => {
    expect((await applyHsCodes(makeContainer(), [])).applied).toBe(0)
    expect((await applyHsCodes(makeContainer(), null as any)).applied).toBe(0)
  })
})

/**
 * Store scoping goes through the sales_channel → products_link pivot, NOT a
 * `sales_channels` filter on product. The filter shape reads fine and passes a
 * mocked query, but mikro-orm rejects it at runtime ("Trying to query by not
 * existing property Product.sales_channels") and every partner-scoped call
 * 500s. Since a mock can't reject it for us, these tests assert the query SHAPE
 * — that's the only place the regression is visible from a unit test.
 */
const makeChannelQuery = (
  products: any[],
  linkedIds = products.map((p) => p.id)
) => {
  const graph = jest.fn(async ({ entity }: any) => {
    if (entity === "sales_channel") {
      return {
        data: [
          {
            id: "sc_1",
            products_link: linkedIds.map((id: string) => ({ product_id: id })),
          },
        ],
      }
    }
    return { data: products }
  })
  return { graph }
}

const productCall = (query: any) =>
  query.graph.mock.calls.map(([a]: any[]) => a).find((a: any) => a.entity === "product")

describe("partitionAssignmentsByStore", () => {
  const storeProducts = [
    {
      id: "prod_mine",
      variants: [
        {
          id: "var_mine",
          inventory_items: [{ inventory: { id: "iitem_mine" } }],
        },
      ],
    },
  ]
  let query = makeChannelQuery(storeProducts)

  beforeEach(() => {
    query = makeChannelQuery(storeProducts)
  })

  it("scopes by the channel pivot, never by a sales_channels filter on product", async () => {
    await partitionAssignmentsByStore(makeContainer({ query }), "sc_1", [
      { level: "product", id: "prod_mine", hs_code: "1" },
    ])

    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "sales_channel",
        filters: { id: "sc_1" },
      })
    )
    expect(productCall(query).filters).toEqual({ id: ["prod_mine"] })
  })

  it("rejects everything when the channel links no products", async () => {
    // An empty `id` filter matches the whole catalogue, so this must short out
    // before the product query rather than fall through to one.
    const empty = makeChannelQuery([], [])
    const { owned, foreign } = await partitionAssignmentsByStore(
      makeContainer({ query: empty }),
      "sc_1",
      [{ level: "product", id: "prod_anything", hs_code: "1" }]
    )

    expect(owned).toHaveLength(0)
    expect(foreign).toHaveLength(1)
    expect(productCall(empty)).toBeUndefined()
  })

  it("keeps ids in the store's catalogue and rejects everything else", async () => {
    const { owned, foreign } = await partitionAssignmentsByStore(
      makeContainer({ query }),
      "sc_1",
      [
        { level: "product", id: "prod_mine", hs_code: "1" },
        { level: "variant", id: "var_mine", hs_code: "2" },
        { level: "inventory_item", id: "iitem_mine", hs_code: "3" },
        { level: "variant", id: "var_someone_else", hs_code: "4" },
        { level: "product", id: "prod_someone_else", hs_code: "5" },
      ]
    )

    expect(owned.map((a) => a.id)).toEqual(["prod_mine", "var_mine", "iitem_mine"])
    expect(foreign.map((a) => a.id)).toEqual([
      "var_someone_else",
      "prod_someone_else",
    ])
  })

  it("does not let an id match across levels", async () => {
    // A product id posted as a variant must not pass just because the string
    // exists somewhere in the store.
    const { owned, foreign } = await partitionAssignmentsByStore(
      makeContainer({ query }),
      "sc_1",
      [{ level: "variant", id: "prod_mine", hs_code: "1" }]
    )
    expect(owned).toHaveLength(0)
    expect(foreign).toHaveLength(1)
  })

  it("rejects everything when the store has no sales channel", async () => {
    // Defaulting open here would turn a misconfigured store into a skeleton key.
    const { owned, foreign } = await partitionAssignmentsByStore(
      makeContainer({ query }),
      null,
      [{ level: "product", id: "prod_mine", hs_code: "1" }]
    )
    expect(owned).toHaveLength(0)
    expect(foreign).toHaveLength(1)
  })
})

describe("scanMissingHsCodes", () => {
  const gapProduct = {
    id: "prod_mine",
    title: "Kala Cotton Shirt",
    hs_code: null,
    variants: [
      { id: "var_mine", manage_inventory: false, hs_code: null, inventory_items: [] },
    ],
  }

  it("scopes a store scan through the channel pivot and pages over its ids", async () => {
    const query = makeChannelQuery([gapProduct], ["prod_b", "prod_mine", "prod_a"])

    const out = await scanMissingHsCodes(makeContainer({ query }), {
      salesChannelId: "sc_1",
      limit: 2,
    })

    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "sales_channel", filters: { id: "sc_1" } })
    )
    const call = productCall(query)
    // Sorted so the page boundary is stable across calls, and paged here rather
    // than in the DB — the ids came from the pivot, not from a product filter.
    expect(call.filters).toEqual({ id: ["prod_a", "prod_b"] })
    expect(call.pagination).toBeUndefined()
    expect(out.has_more).toBe(true)
  })

  it("returns an empty page without querying products when the channel is empty", async () => {
    const query = makeChannelQuery([], [])

    const out = await scanMissingHsCodes(makeContainer({ query }), {
      salesChannelId: "sc_1",
    })

    expect(out).toMatchObject({ gaps: [], scanned: 0, covered: 0, has_more: false })
    expect(productCall(query)).toBeUndefined()
  })

  it("keeps DB-side pagination for the unscoped admin scan", async () => {
    const query = makeChannelQuery([gapProduct])

    const out = await scanMissingHsCodes(makeContainer({ query }), {
      limit: 10,
      offset: 20,
    })

    const call = productCall(query)
    expect(call.filters).toEqual({})
    expect(call.pagination).toEqual({ skip: 20, take: 10 })
    expect(out.gaps).toHaveLength(1)
    expect(out.gaps[0].suggested_target).toEqual({ level: "product", id: "prod_mine" })
  })
})
