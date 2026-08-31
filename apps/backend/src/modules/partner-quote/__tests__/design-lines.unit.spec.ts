import {
  applyDesignResolutions,
  designsNeedingAVariant,
  isMadeToOrderDesignProduct,
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
    expect(row.made_to_order).toBe(false)
    expect(row.candidates).toEqual([])
  })

  /**
   * The case this whole change is about. A design with no product used to be
   * greyed with "create a product from the design first" — a step that only
   * exists because the resolver needs a variant to point at, and one nobody
   * should have to do for work that has not been sold yet.
   */
  it("reads a design with no product as made-to-order, not as a problem", () => {
    const row = toQuotableDesign(
      { id: "des_2", name: "Custom Kurta" },
      {
        design_id: "des_2",
        design_name: "Custom Kurta",
        visible: true,
        variant_id: null,
        candidates: [],
        reason: "has no product behind it yet",
      }
    )
    expect(row.made_to_order).toBe(true)
    // Still not `quotable`: it has no variant and no settled price YET. The
    // two flags mean different things and the UI labels them differently.
    expect(row.quotable).toBe(false)
    // 🔴 No reason string. There is nothing wrong with this row, and a reason
    // renders as a problem in every UI that shows one.
    expect(row.reason).toBeNull()
  })

  it("still reports a reason for a design sold as several variants", () => {
    const row = toQuotableDesign({ id: "des_1", name: "Kashida Shawl" }, ambiguous("des_1"))
    expect(row.made_to_order).toBe(false)
    expect(row.reason).toContain("pick the one")
  })

  it("still says nothing about a design this caller cannot see", () => {
    const row = toQuotableDesign(
      { id: "des_3", name: null },
      {
        design_id: "des_3",
        design_name: null,
        visible: false,
        variant_id: null,
        candidates: [],
        reason: "Design des_3 does not exist.",
      }
    )
    // Invisible must not become made-to-order — that would answer "not yours"
    // by offering to create something.
    expect(row.made_to_order).toBe(false)
    expect(row.reason).toContain("does not exist")
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

/**
 * Made-to-order: a design with no product is quoted, not refused.
 *
 * The gate used to be "has someone created a product from this design", which
 * is a step that only exists because the resolver needs a variant to point at.
 * For custom work whose production run is in the FUTURE there is nothing to
 * create a product from yet, so the answer was always no.
 */
describe("designsNeedingAVariant", () => {
  const resolution = (over: Partial<DesignResolution> = {}): DesignResolution => ({
    design_id: "d1",
    design_name: "Custom Kurta",
    visible: true,
    variant_id: null,
    candidates: [],
    reason: null,
    ...over,
  })

  const mapOf = (...rs: DesignResolution[]) =>
    new Map(rs.map((r) => [r.design_id, r]))

  it("names a visible design with no product at all", () => {
    const out = designsNeedingAVariant(
      [{ design_id: "d1", quantity: 10 }],
      mapOf(resolution())
    )
    expect(out).toEqual(["d1"])
  })

  it("skips a design that already resolves to one variant", () => {
    const out = designsNeedingAVariant(
      [{ design_id: "d1", quantity: 10 }],
      mapOf(
        resolution({
          variant_id: "v1",
          candidates: [
            { variant_id: "v1", title: null, sku: null, product_id: "p1", product_title: null },
          ],
        })
      )
    )
    expect(out).toEqual([])
  })

  it("skips a design sold as several variants — that is the partner's choice", () => {
    const out = designsNeedingAVariant(
      [{ design_id: "d1", quantity: 10 }],
      mapOf(
        resolution({
          candidates: [
            { variant_id: "v1", title: "S", sku: null, product_id: "p1", product_title: null },
            { variant_id: "v2", title: "M", sku: null, product_id: "p1", product_title: null },
          ],
        })
      )
    )
    // 🔴 Minting a third would not answer "which size" — it would add one.
    expect(out).toEqual([])
  })

  it("🔴 skips a line that already NAMES its own variant", () => {
    const out = designsNeedingAVariant(
      // The design has no product, but this line chose a variant explicitly.
      [{ design_id: "d1", variant_id: "v-chosen", quantity: 10 }],
      mapOf(resolution())
    )
    /**
     * Minting here would attach a SECOND variant to the design, making it
     * ambiguous — the one state that cannot be quoted at all. The fix would
     * create the bug it exists to remove.
     */
    expect(out).toEqual([])
  })

  it("skips a design that is not visible to this caller", () => {
    const out = designsNeedingAVariant(
      [{ design_id: "d1", quantity: 10 }],
      mapOf(resolution({ visible: false }))
    )
    // "Not yours" must not be answered by creating something.
    expect(out).toEqual([])
  })

  it("de-duplicates a design that appears on several lines", () => {
    const out = designsNeedingAVariant(
      [
        { design_id: "d1", quantity: 10 },
        { design_id: "d1", quantity: 25 },
      ],
      mapOf(resolution())
    )
    // Two mints would leave the design resolving to two variants.
    expect(out).toEqual(["d1"])
  })
})

/**
 * Whose catalogue a design-led line may be added to (#1486 tail).
 *
 * 🔴 The interesting cases are the two REFUSALS, not the acceptance. A custom
 * product quoted as a plain variant has nothing running that would attach the
 * catalogue link, so calling it "pending" is a promise no code keeps; and a
 * design resolved through a real catalogue product points at something another
 * partner owns, where an automatic attach is a cross-tenant write. Both must be
 * false, and a test that only asserts the happy path would pass through either.
 */
describe("isMadeToOrderDesignProduct", () => {
  const minted = { metadata: { is_custom_design: true, design_id: "d1" } }

  it("is true only for a minted design product ON a design line", () => {
    expect(isMadeToOrderDesignProduct(minted, true)).toBe(true)
  })

  it("🔴 is false for the same product quoted as a plain variant", () => {
    // Nothing in the design machinery runs for that line, so nothing would
    // ever attach the channel this would be promising.
    expect(isMadeToOrderDesignProduct(minted, false)).toBe(false)
  })

  it("🔴 is false for a real catalogue product reached through a design", () => {
    // Someone else owns this catalogue. Adding it to the quoting partner's
    // sales channel would be the #1419 failure with an extra step.
    expect(
      isMadeToOrderDesignProduct({ metadata: { design_id: "d1" } }, true)
    ).toBe(false)
    expect(isMadeToOrderDesignProduct({ metadata: null }, true)).toBe(false)
    expect(isMadeToOrderDesignProduct(null, true)).toBe(false)
  })

  it("does not accept a truthy-but-not-true flag", () => {
    // `metadata` is untyped JSON; "false" and 1 both arrive from somewhere.
    expect(
      isMadeToOrderDesignProduct({ metadata: { is_custom_design: "false" } }, true)
    ).toBe(false)
    expect(
      isMadeToOrderDesignProduct({ metadata: { is_custom_design: 1 } }, true)
    ).toBe(false)
  })
})
