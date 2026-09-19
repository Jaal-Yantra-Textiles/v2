import { describe, expect, it } from "vitest"

import { deriveDesignSizes, normalizeColorPalette } from "../design-spec"

describe("deriveDesignSizes", () => {
  it("uses size_sets when present", () => {
    expect(
      deriveDesignSizes([{ size_label: "M", measurements: { chest: 40 } }], null)
    ).toEqual([{ label: "M", measurements: { chest: 40 } }])
  })

  it("drops a size set with no label", () => {
    expect(
      deriveDesignSizes(
        [{ size_label: "M" }, { size_label: null }, { measurements: {} }],
        null
      )
    ).toHaveLength(1)
  })

  /**
   * 🔴 The two are GENERATIONS of the same field, not halves of one list.
   * Merging them doubles every size on a migrated design, which is most.
   */
  it("ignores custom_sizes entirely once size_sets exist", () => {
    const out = deriveDesignSizes([{ size_label: "M" }], { S: {}, L: {} })
    expect(out.map((s) => s.label)).toEqual(["M"])
  })

  it("falls back to custom_sizes when there are no size_sets", () => {
    expect(
      deriveDesignSizes([], { S: { chest: 38 } }).map((s) => s.label)
    ).toEqual(["S"])
    expect(deriveDesignSizes(null, { S: {} })).toHaveLength(1)
  })

  it("is empty when neither source has anything", () => {
    expect(deriveDesignSizes(null, null)).toEqual([])
    expect(deriveDesignSizes([], {})).toEqual([])
    // An array in the custom_sizes slot is the wrong shape, not a size list.
    expect(deriveDesignSizes(null, [] as any)).toEqual([])
  })
})

describe("normalizeColorPalette", () => {
  it("handles an array of plain strings", () => {
    expect(normalizeColorPalette(["#fff", "#000"])).toEqual([
      { name: "#fff", value: "#fff" },
      { name: "#000", value: "#000" },
    ])
  })

  it.each(["hex", "value", "code"])(
    "reads the colour off the %s key",
    (key) => {
      expect(
        normalizeColorPalette([{ name: "Ink", [key]: "#123456" }])
      ).toEqual([{ name: "Ink", value: "#123456" }])
    }
  )

  it("handles an object keyed by colour name", () => {
    expect(normalizeColorPalette({ Ink: "#123456" })).toEqual([
      { name: "Ink", value: "#123456" },
    ])
  })

  it("falls back to the value as the name", () => {
    expect(normalizeColorPalette([{ hex: "#abc" }])).toEqual([
      { name: "#abc", value: "#abc" },
    ])
  })

  /**
   * 🔴 A swatch with no usable colour is dropped, not rendered transparent.
   * An invisible circle with a label beside it reads as a rendering bug
   * rather than as missing data.
   */
  it("drops entries with no usable colour", () => {
    expect(
      normalizeColorPalette([
        { name: "Nothing" },
        { name: "Blank", hex: "  " },
        "",
        null,
        42,
      ])
    ).toEqual([])
  })

  it("is empty for a non-object palette", () => {
    for (const v of [null, undefined, "#fff", 7]) {
      expect(normalizeColorPalette(v)).toEqual([])
    }
  })
})
