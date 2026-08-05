import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const updateVariantsRun = jest.fn().mockResolvedValue({ result: [] })
const updateProductsRun = jest.fn().mockResolvedValue({ result: [] })

jest.mock("@medusajs/medusa/core-flows", () => ({
  updateProductVariantsWorkflow: () => ({ run: updateVariantsRun }),
  updateProductsWorkflow: () => ({ run: updateProductsRun }),
}))

import { applyHsCodes, partitionAssignmentsByStore } from "../hs-codes"

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

describe("partitionAssignmentsByStore", () => {
  const query = {
    graph: jest.fn().mockResolvedValue({
      data: [
        {
          id: "prod_mine",
          variants: [
            {
              id: "var_mine",
              inventory_items: [{ inventory: { id: "iitem_mine" } }],
            },
          ],
        },
      ],
    }),
  }

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
