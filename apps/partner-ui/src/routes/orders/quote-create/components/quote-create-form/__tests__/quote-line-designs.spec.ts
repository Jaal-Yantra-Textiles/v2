import { describe, expect, it } from "vitest"

import { assignDesign, designLineRows } from "../quote-line-designs"

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

describe("designLineRows", () => {
  it("lists only the variants carrying a quantity", () => {
    // A ten-variant product selected to quote one of them must not produce nine
    // rows asking the partner to attribute lines that will never be minted.
    const rows = designLineRows(PRODUCTS, { var_m: 200 })
    expect(rows.map((r) => r.id)).toEqual(["var_m"])
  })

  it("🔴 treats an empty quantity as no line, not as zero", () => {
    // `Number("")` is 0, and a truthiness check on the raw cell would get this
    // exactly backwards. The same coercion already parsed a truncated quote
    // link as "remove this line" once.
    expect(designLineRows(PRODUCTS, { var_m: "" })).toEqual([])
    expect(designLineRows(PRODUCTS, { var_m: 0 })).toEqual([])
    expect(designLineRows(PRODUCTS, { var_m: "200" })).toHaveLength(1)
  })

  it("falls back to the SKU when a variant has no title", () => {
    const rows = designLineRows(PRODUCTS, { var_one: 5 })
    expect(rows[0].label).toBe("Pashmina Stole — PAS-1")
  })

  it("is empty rather than throwing when nothing is selected", () => {
    expect(designLineRows([], {})).toEqual([])
    expect(designLineRows(PRODUCTS, undefined)).toEqual([])
  })
})

describe("assignDesign", () => {
  it("sets a design on a line", () => {
    expect(assignDesign({}, "var_m", "des_1")).toEqual({ var_m: "des_1" })
  })

  it("🔴 DELETES the key when cleared rather than writing an empty string", () => {
    // The payload builder sends `design_id` whenever the entry is present, so
    // "" would travel to the mint as a design id and be refused as one that
    // does not exist — clearing a field would produce a failed mint.
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
