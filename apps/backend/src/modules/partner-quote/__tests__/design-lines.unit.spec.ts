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
  visible: true,
  variant_id: variantId,
  candidates: [
    { variant_id: variantId, title: "One size", sku: "KAS-1", product_id: "prod_1", product_title: "Kashida Shawl" },
  ],
  reason: null,
})

const ambiguous = (designId: string): DesignResolution => ({
  design_id: designId,
  design_name: "Kashida Shawl",
  visible: true,
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
  visible: true,
  variant_id: null,
  candidates: [],
  reason: '"Sketch only" has no product behind it yet, so there is nothing to price. Create a product from the design first.',
})

/**
 * A design that is not this caller's to quote — or does not exist.
 *
 * 🔑 The two answer IDENTICALLY on purpose, so an id cannot be probed for
 * existence by attaching it to a quote line.
 */
const invisible = (designId: string): DesignResolution => ({
  design_id: designId,
  design_name: null,
  visible: false,
  variant_id: null,
  candidates: [],
  reason: `Design ${designId} does not exist.`,
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

  it("🔴 refuses a design this caller may not quote, even on a line that names its variant", () => {
    // The hole #1501 closes. A line with a variant skipped design resolution
    // ENTIRELY, so any string at all — including another partner's design id —
    // was frozen onto the quote as its design. Nothing renders it today, which
    // is the only reason it was not a leak.
    const { errors } = applyDesignResolutions(
      [{ variant_id: "var_mine", design_id: "des_theirs", quantity: 50 }],
      new Map([["des_theirs", invisible("des_theirs")]])
    )

    expect(errors).toHaveLength(1)
    // The same words a design that does not exist gets, so an id cannot be
    // probed for existence by attaching it to a line.
    expect(errors[0]).toContain("does not exist")
  })

  it("does NOT move the line to the design's own variant", () => {
    // Attaching a design to a line the partner already chose must never
    // silently re-point it at a different SKU — that would change what is being
    // sold as a side effect of recording what it was made from.
    const { lines, errors } = applyDesignResolutions(
      [{ variant_id: "var_chosen", design_id: "des_1", quantity: 50 }],
      new Map([["des_1", resolved("des_1", "var_other")]])
    )

    expect(errors).toEqual([])
    expect(lines[0].variant_id).toBe("var_chosen")
    expect(lines[0].design_id).toBe("des_1")
  })

  it("accepts an UNBACKED design as provenance once the variant is chosen", () => {
    // Visibility, not resolvability. "No product behind it" is a perfectly good
    // answer to "which design is this" when the buyer is being sold a variant
    // that already exists — refusing it would block the ordinary case of
    // recording the sketch a catalogue product was made from.
    const { errors } = applyDesignResolutions(
      [{ variant_id: "var_chosen", design_id: "des_2", quantity: 50 }],
      new Map([["des_2", unbacked("des_2")]])
    )
    expect(errors).toEqual([])
  })

  it("accepts an AMBIGUOUS design as provenance too", () => {
    const { errors } = applyDesignResolutions(
      [{ variant_id: "var_m", design_id: "des_1", quantity: 50 }],
      new Map([["des_1", ambiguous("des_1")]])
    )
    expect(errors).toEqual([])
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
