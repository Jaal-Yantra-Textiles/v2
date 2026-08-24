import { assignDesign, designLineRows } from "../line-designs"

/**
 * The admin twin of `partner-ui`'s `quote-line-designs.spec.ts` (#1501).
 *
 * ⚠️ The two wizards cannot share a module — different build graphs — so they
 * share ASSERTIONS instead. If one copy drifts, one of these two files goes
 * red; without them the two mint surfaces would quietly disagree about what a
 * cleared design field means, which is the kind of difference nobody notices
 * until a quote mints wrong on one of them.
 */

const PRODUCTS = [
  {
    title: "Kashida Shawl",
    variants: [
      { id: "var_s", title: "S", sku: "KAS-S" },
      { id: "var_m", title: "M", sku: "KAS-M" },
    ],
  },
  {
    title: "Pashmina Stole",
    variants: [{ id: "var_one", title: null, sku: "PAS-1" }],
  },
]

describe("designLineRows (admin)", () => {
  it("lists only the variants carrying a quantity", () => {
    expect(designLineRows(PRODUCTS, { var_m: 200 }).map((r) => r.id)).toEqual([
      "var_m",
    ])
  })

  it("🔴 treats an empty quantity as no line, not as zero", () => {
    // `Number("")` is 0. The same coercion already parsed a truncated quote
    // link as "remove this line".
    expect(designLineRows(PRODUCTS, { var_m: "" })).toEqual([])
    expect(designLineRows(PRODUCTS, { var_m: 0 })).toEqual([])
    expect(designLineRows(PRODUCTS, { var_m: "200" })).toHaveLength(1)
  })

  it("falls back to the SKU when a variant has no title", () => {
    expect(designLineRows(PRODUCTS, { var_one: 5 })[0].label).toBe(
      "Pashmina Stole — PAS-1"
    )
  })

  it("is empty rather than throwing when nothing is selected", () => {
    expect(designLineRows([], {})).toEqual([])
    expect(designLineRows(PRODUCTS, undefined)).toEqual([])
  })
})

describe("assignDesign (admin)", () => {
  it("sets a design on a line", () => {
    expect(assignDesign({}, "var_m", "des_1")).toEqual({ var_m: "des_1" })
  })

  it("🔴 DELETES the key when cleared rather than writing an empty string", () => {
    const cleared = assignDesign({ var_m: "des_1" }, "var_m", undefined)
    expect("var_m" in cleared).toBe(false)
    expect(assignDesign({ var_m: "des_1" }, "var_m", "")).toEqual({})
  })

  it("leaves every other line alone", () => {
    expect(
      assignDesign({ var_s: "des_a", var_m: "des_b" }, "var_m", "des_c")
    ).toEqual({ var_s: "des_a", var_m: "des_c" })
  })

  it("returns a NEW object so the form sees a change", () => {
    const current = { var_s: "des_a" }
    expect(assignDesign(current, "var_m", "des_b")).not.toBe(current)
  })
})
