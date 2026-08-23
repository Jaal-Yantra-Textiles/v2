import {
  applyDesignResolutions,
  withDesignIssues,
  type DesignResolution,
} from "../lib/design-lines"
import { toQuotableDesign } from "../lib/quotable-designs"

/**
 * Quoting a design (#1486).
 *
 * 🔴 The assertion that matters is the AMBIGUOUS one. A design sold as several
 * variants has no single right answer, and picking the first would quote a
 * size or colour nobody chose — at a price that is probably right, on a
 * document the buyer signs off. Every test that merely asserts "a quote came
 * out" passes while that happens.
 */

const resolved = (designId: string, variantId: string): DesignResolution => ({
  design_id: designId,
  design_name: "Kashida Shawl",
  variant_id: variantId,
  candidates: [
    { variant_id: variantId, title: "One size", sku: "KAS-1", product_id: "prod_1", product_title: "Kashida Shawl" },
  ],
  reason: null,
})

const ambiguous = (designId: string): DesignResolution => ({
  design_id: designId,
  design_name: "Kashida Shawl",
  variant_id: null,
  candidates: [
    { variant_id: "var_s", title: "S", sku: "KAS-S", product_id: "prod_1", product_title: "Kashida Shawl" },
    { variant_id: "var_m", title: "M", sku: "KAS-M", product_id: "prod_1", product_title: "Kashida Shawl" },
  ],
  reason: '"Kashida Shawl" is sold as 2 variants — pick the one to quote.',
})

const unbacked = (designId: string): DesignResolution => ({
  design_id: designId,
  design_name: "Sketch only",
  variant_id: null,
  candidates: [],
  reason: '"Sketch only" has no product behind it yet, so there is nothing to price. Create a product from the design first.',
})

describe("applyDesignResolutions", () => {
  it("fills the variant a design resolves to", () => {
    const { lines, errors } = applyDesignResolutions(
      [{ design_id: "des_1", quantity: 50 }],
      new Map([["des_1", resolved("des_1", "var_1")]])
    )

    expect(errors).toEqual([])
    expect(lines[0].variant_id).toBe("var_1")
    // Provenance survives — it is what lets the quote name the design.
    expect(lines[0].design_id).toBe("des_1")
  })

  it("🔴 refuses a design sold as several variants instead of picking one", () => {
    const { lines, errors } = applyDesignResolutions(
      [{ design_id: "des_1", quantity: 50 }],
      new Map([["des_1", ambiguous("des_1")]])
    )

    expect(lines[0].variant_id).toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("2 variants")
  })

  it("refuses a design with no product behind it", () => {
    const { errors } = applyDesignResolutions(
      [{ design_id: "des_2", quantity: 5 }],
      new Map([["des_2", unbacked("des_2")]])
    )
    expect(errors[0]).toContain("no product behind it")
  })

  it("lets an explicit variant win — that is how an ambiguous design gets quoted", () => {
    const { lines, errors } = applyDesignResolutions(
      [{ design_id: "des_1", variant_id: "var_m", quantity: 50 }],
      new Map([["des_1", ambiguous("des_1")]])
    )

    expect(errors).toEqual([])
    expect(lines[0].variant_id).toBe("var_m")
  })

  it("collects EVERY failure, not the first", () => {
    // A partner fixing a five-line basket one error per round-trip is how a
    // wizard stops being used.
    const { errors } = applyDesignResolutions(
      [
        { design_id: "des_1", quantity: 1 },
        { design_id: "des_2", quantity: 2 },
        { variant_id: "var_plain", quantity: 3 },
      ],
      new Map([
        ["des_1", ambiguous("des_1")],
        ["des_2", unbacked("des_2")],
      ])
    )

    expect(errors).toHaveLength(2)
  })

  it("leaves a plain product line completely alone", () => {
    const line = { variant_id: "var_plain", quantity: 3, note: "as before" }
    const { lines, errors } = applyDesignResolutions([line], new Map())
    expect(errors).toEqual([])
    expect(lines[0]).toBe(line)
  })
})

describe("toQuotableDesign", () => {
  it("marks a resolvable design quotable and names its variant", () => {
    const row = toQuotableDesign(
      { id: "des_1", name: "Kashida Shawl", status: "Approved", thumbnail_url: "t.png", product_type: "shawl" },
      resolved("des_1", "var_1")
    )
    expect(row.quotable).toBe(true)
    expect(row.variant_id).toBe("var_1")
    expect(row.reason).toBeNull()
  })

  it("keeps an unquotable design in the list, with the reason and the candidates", () => {
    // Hiding it makes the picker lie: the partner knows the design exists,
    // cannot find it, and never learns what the fix is.
    const row = toQuotableDesign({ id: "des_1", name: "Kashida Shawl" }, ambiguous("des_1"))
    expect(row.quotable).toBe(false)
    expect(row.variant_id).toBeNull()
    expect(row.candidates).toHaveLength(2)
    expect(row.reason).toContain("pick the one")
  })

  it("does not claim quotable when nothing resolved it at all", () => {
    const row = toQuotableDesign({ id: "des_9", name: "Unknown" }, undefined)
    expect(row.quotable).toBe(false)
    expect(row.candidates).toEqual([])
  })
})

describe("withDesignIssues", () => {
  const clean = {
    ready: true,
    issues: [],
    blocking_count: 0,
    warning_count: 0,
    freight: { chosen: null, total_weight_grams: null, error: null },
  }

  it("🔴 flips `ready` to false — a blocking row under a green tick is the bug", () => {
    const out = withDesignIssues(clean, [
      { code: "design_unresolved", severity: "blocking", message: "nope", design_id: "des_1" },
    ])
    expect(out.ready).toBe(false)
    expect(out.blocking_count).toBe(1)
    expect(out.issues).toHaveLength(1)
  })

  it("keeps the existing issues and counts them together", () => {
    const out = withDesignIssues(
      { ...clean, ready: false, issues: [{ code: "weight_missing", severity: "warning", message: "w" }], warning_count: 1 },
      [{ code: "design_unresolved", severity: "blocking", message: "nope", design_id: "des_1" }]
    )
    expect(out.issues).toHaveLength(2)
    expect(out.blocking_count).toBe(1)
    expect(out.warning_count).toBe(1)
  })

  it("returns the readiness untouched when there are no design issues", () => {
    expect(withDesignIssues(clean, [])).toBe(clean)
  })
})
