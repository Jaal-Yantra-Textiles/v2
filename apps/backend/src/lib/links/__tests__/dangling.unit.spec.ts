import { linkedRows, presentRows } from "../dangling"

/**
 * The null a dangling link row arrives as (#1857).
 *
 * 🔴 These cases are written from the two REAL failures, not from the shape of
 * the helper: the partner page that died on `person.id` off a null, and the
 * production-run split that handed a share of the quantity to a partner that
 * does not exist.
 */
describe("linkedRows", () => {
  it("drops the nulls and counts them", () => {
    const { rows, dangling } = linkedRows([
      { id: "per_1" },
      null,
      null,
      { id: "per_2" },
    ])
    expect(rows).toEqual([{ id: "per_1" }, { id: "per_2" }])
    expect(dangling).toBe(2)
  })

  it("reports a wholly dangling collection as empty AND dangling", () => {
    // The measured case: four link rows, zero people. `rows.length === 0` alone
    // is indistinguishable from "nobody was ever linked", which is why the
    // count is returned rather than swallowed.
    const { rows, dangling } = linkedRows([null, null, null, null])
    expect(rows).toEqual([])
    expect(dangling).toBe(4)
  })

  it("keeps rows that carry no id", () => {
    /*
     * 🔴 The regression this exists to prevent. Several callers request a
     * single column — `fields: ["stores.default_sales_channel_id"]` — so a
     * predicate of `!!r.id` would discard every RESOLVED row and report total
     * loss. A dangling link is `null`, and that is all this looks for.
     */
    const { rows, dangling } = linkedRows([
      { default_sales_channel_id: "sc_1" },
      null,
    ])
    expect(rows).toEqual([{ default_sales_channel_id: "sc_1" }])
    expect(dangling).toBe(1)
  })

  it("treats a missing field as empty rather than throwing", () => {
    expect(linkedRows(undefined)).toEqual({ rows: [], dangling: 0 })
    expect(linkedRows(null)).toEqual({ rows: [], dangling: 0 })
  })

  it("wraps a single object, because a to-one link is not an array", () => {
    expect(linkedRows({ id: "st_1" }).rows).toEqual([{ id: "st_1" }])
  })
})

describe("presentRows — the index-0 trap", () => {
  it("picks the first store that RESOLVED, not stores[0]", () => {
    /*
     * The whole reason `stores?.[0]?.x` is not good enough: optional chaining
     * turns a dangling row at index 0 into `undefined` and the caller falls
     * through to "this partner has no store", while a real store sits at
     * index 1.
     */
    const stores = [null, { id: "st_2", default_sales_channel_id: "sc_2" }]
    expect((stores as any)[0]?.default_sales_channel_id).toBeUndefined()
    expect(presentRows(stores)[0]?.default_sales_channel_id).toBe("sc_2")
  })
})
