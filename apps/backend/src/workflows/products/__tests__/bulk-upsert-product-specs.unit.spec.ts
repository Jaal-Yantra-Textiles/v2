/**
 * The rules that make a batch spec write safe, pinned.
 *
 * The write itself is `upsertProductSpecWorkflow`, already covered by the
 * product-spec module's own suite. What is new here — and what can quietly go
 * wrong across a hundred rows — is everything AROUND the write: which rows are
 * allowed, which are silently collapsed, and whether a dry run tells the truth
 * about what it would replace.
 */

jest.mock("../upsert-product-spec", () => ({
  upsertProductSpecWorkflow: jest.fn(),
}))

import {
  bulkUpsertProductSpecs,
  BULK_SPEC_MAX_PRODUCTS,
} from "../bulk-upsert-product-specs"
import { upsertProductSpecWorkflow } from "../upsert-product-spec"

const runMock = jest.fn()

const makeContainer = (specsByProduct: Record<string, unknown> = {}) => ({
  resolve: () => ({
    findByProduct: async (id: string) => specsByProduct[id] ?? null,
  }),
})

beforeEach(() => {
  jest.clearAllMocks()
  runMock.mockResolvedValue({ result: {} })
  ;(upsertProductSpecWorkflow as unknown as jest.Mock).mockReturnValue({
    run: runMock,
  })
})

const SPEC = { weave_technique: "pashmina-plain" }

describe("bulkUpsertProductSpecs", () => {
  it("writes nothing at all under dry_run", async () => {
    const res = await bulkUpsertProductSpecs(
      makeContainer(),
      { products: [{ product_id: "prod_1" }], spec: SPEC, dry_run: true }
    )

    expect(runMock).not.toHaveBeenCalled()
    expect(res.dry_run).toBe(true)
    expect(res.results[0]).toMatchObject({ product_id: "prod_1", ok: true })
  })

  it("reports created vs updated from what is actually stored", async () => {
    const res = await bulkUpsertProductSpecs(
      makeContainer({ prod_has: { id: "spec_1" } }),
      {
        products: [{ product_id: "prod_has" }, { product_id: "prod_none" }],
        spec: SPEC,
        dry_run: true,
      }
    )

    expect(res.results).toEqual([
      expect.objectContaining({ product_id: "prod_has", action: "updated" }),
      expect.objectContaining({ product_id: "prod_none", action: "created" }),
    ])
  })

  it("names the replace-wholesale keys so a dry run can be read as a warning", async () => {
    // colors/fields/options REPLACE stored rows. Across a batch this is the
    // sharpest edge, and a plan that does not name it is a plan that hides it.
    const res = await bulkUpsertProductSpecs(
      makeContainer(),
      {
        products: [{ product_id: "prod_1" }],
        spec: { ...SPEC, colors: [], options: [] } as any,
        dry_run: true,
      }
    )

    expect(res.results[0].replaces).toEqual(["colors", "options"])
  })

  it("omits `replaces` when the spec touches none of those keys", async () => {
    const res = await bulkUpsertProductSpecs(
      makeContainer(),
      { products: [{ product_id: "prod_1" }], spec: SPEC, dry_run: true }
    )

    expect(res.results[0].replaces).toBeUndefined()
  })

  it("lets a row's own spec win over the batch-wide one", async () => {
    await bulkUpsertProductSpecs(makeContainer(), {
      products: [
        { product_id: "prod_1", spec: { weave_technique: "kani" } as any },
        { product_id: "prod_2" },
      ],
      spec: SPEC,
    })

    expect(runMock).toHaveBeenCalledTimes(2)
    expect(runMock.mock.calls[0][0].input.data).toEqual({
      weave_technique: "kani",
    })
    expect(runMock.mock.calls[1][0].input.data).toEqual(SPEC)
  })

  it("turns an out-of-scope id into an error row instead of writing it", async () => {
    const res = await bulkUpsertProductSpecs(
      makeContainer(),
      {
        products: [{ product_id: "mine" }, { product_id: "someone_elses" }],
        spec: SPEC,
      },
      { allowedProductIds: new Set(["mine"]) }
    )

    expect(runMock).toHaveBeenCalledTimes(1)
    expect(runMock.mock.calls[0][0].input.product_id).toBe("mine")
    expect(res.error_count).toBe(1)
    // "not found", never "not yours" — a partner must not be able to use this
    // route to discover that a product exists and belongs to someone else.
    expect(res.results[1].error).toBe("Product someone_elses not found")
  })

  it("keeps the rest of the batch when one row throws", async () => {
    runMock
      .mockRejectedValueOnce(new Error("bad weave param"))
      .mockResolvedValue({ result: {} })

    const res = await bulkUpsertProductSpecs(makeContainer(), {
      products: [{ product_id: "prod_bad" }, { product_id: "prod_good" }],
      spec: SPEC,
    })

    expect(res.ok_count).toBe(1)
    expect(res.error_count).toBe(1)
    expect(res.results[0].error).toBe("bad weave param")
    expect(res.results[1].ok).toBe(true)
  })

  it("collapses a duplicated product to its last entry, and says so", async () => {
    // Writing twice would be worse than it looks: because colors/fields/options
    // replace, the second write silently discards the first.
    const res = await bulkUpsertProductSpecs(makeContainer(), {
      products: [
        { product_id: "prod_1", spec: { weave_technique: "first" } as any },
        { product_id: "prod_1", spec: { weave_technique: "last" } as any },
      ],
    })

    expect(runMock).toHaveBeenCalledTimes(1)
    expect(runMock.mock.calls[0][0].input.data).toEqual({
      weave_technique: "last",
    })
    expect(res.warnings.join(" ")).toContain("more than once")
  })

  it("errors the row when neither a row spec nor a batch spec is given", async () => {
    const res = await bulkUpsertProductSpecs(makeContainer(), {
      products: [{ product_id: "prod_1" }],
    })

    expect(runMock).not.toHaveBeenCalled()
    expect(res.results[0].action).toBe("error")
  })

  it("caps the batch and warns rather than silently truncating", async () => {
    const products = Array.from(
      { length: BULK_SPEC_MAX_PRODUCTS + 5 },
      (_, i) => ({ product_id: `prod_${i}` })
    )

    const res = await bulkUpsertProductSpecs(makeContainer(), {
      products,
      spec: SPEC,
    })

    expect(res.requested).toBe(BULK_SPEC_MAX_PRODUCTS)
    expect(res.warnings.join(" ")).toContain("only the first")
  })

  it("still writes when the existing-spec lookup fails", async () => {
    // The read only decides the created/updated label. Failing the row for it
    // would refuse a legitimate write over a cosmetic detail.
    const container = {
      resolve: () => ({
        findByProduct: async () => {
          throw new Error("db hiccup")
        },
      }),
    }

    const res = await bulkUpsertProductSpecs(container, {
      products: [{ product_id: "prod_1" }],
      spec: SPEC,
    })

    expect(runMock).toHaveBeenCalledTimes(1)
    expect(res.ok_count).toBe(1)
  })
})
