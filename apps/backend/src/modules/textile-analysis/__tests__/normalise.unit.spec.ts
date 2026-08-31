import { normaliseTextileAnalysis } from "../lib/normalise"

/**
 * The typed/untyped line, which is the whole point of this module.
 *
 * 🔴 The interesting assertions are the NORMALISATION and the confidence
 * handling, not the happy-path mapping. A `cloth_type` of "Top" that does not
 * equal "top" makes `WHERE cloth_type = ?` return a fraction of the matches and
 * the "more fabrics like this" feature quietly under-answers — the failure mode
 * that looks like a thin catalogue rather than a bug.
 */

// The real production payload shape, trimmed. Keeping it recognisable matters:
// a tidier fixture than reality is how wrong code gets certified.
const PAYLOAD = {
  title: "Beige Long-Sleeve Top with Red Poppy Floral Back Motif",
  description: "A relaxed long-sleeve top in a soft beige/tan cotton-like fabric.",
  colors: ["beige", "tan", "khaki", "red"],
  season: ["Spring", "Fall"],
  pattern: "floral",
  category: "tops",
  cloth_type: "top",
  confidence: 0.62,
  occasion: ["Casual", "Office"],
  fabric_weight: "medium-weight",
  seo_keywords: ["beige top", "floral back top"],
  suggested_price: { amount: 65, currency: "USD" },
  target_audience: "Women aged 25-50",
  care_instructions: [],
  model_name: null,
  body_raw: null,
  face_raw: null,
  designer: null,
  visual_observations: {
    fabric: {
      texture: "smooth, matte",
      weave_or_knit: null,
      perceived_weight: "medium",
    },
    visible_pattern: "floral",
    visible_colors: ["beige", "tan", "red"],
  },
  model_characteristics: { shot_type: "flat lay" },
}

describe("normaliseTextileAnalysis", () => {
  it("maps the filter columns and lowercases them", () => {
    const out = normaliseTextileAnalysis(PAYLOAD, {
      source: "internal_extraction",
    })

    expect(out.cloth_type).toBe("top")
    expect(out.category).toBe("tops")
    expect(out.pattern).toBe("floral")
    expect(out.fabric_weight).toBe("medium-weight")
    // First named colour is the dominant one — what "like this" matches on.
    expect(out.primary_color).toBe("beige")
    expect(out.source).toBe("internal_extraction")
  })

  it("🔴 normalises case and whitespace, so two spellings compare equal", () => {
    const out = normaliseTextileAnalysis(
      { ...PAYLOAD, cloth_type: "  Top ", pattern: "Floral" },
      { source: "internal_extraction" }
    )
    // Without this, "Top" and "top" are different fabrics to a WHERE clause and
    // the matcher silently returns a subset.
    expect(out.cloth_type).toBe("top")
    expect(out.pattern).toBe("floral")
  })

  it("falls back to visual_observations for what the top level omits", () => {
    const out = normaliseTextileAnalysis(
      {
        ...PAYLOAD,
        pattern: null,
        fabric_weight: null,
        colors: null,
        visual_observations: {
          ...PAYLOAD.visual_observations,
          weave_or_knit: undefined,
          fabric: { weave_or_knit: "woven", perceived_weight: "heavy" },
          visible_pattern: "stripe",
          visible_colors: ["indigo", "cream"],
        },
      },
      { source: "internal_extraction" }
    )

    expect(out.pattern).toBe("stripe")
    expect(out.fabric_weight).toBe("heavy")
    expect(out.weave_or_knit).toBe("woven")
    expect(out.primary_color).toBe("indigo")
  })

  it("🔴 keeps a missing confidence NULL rather than coercing it to 0", () => {
    // `Number(null)` is 0 and `Number.isFinite(0)` is true, so a coerce-first
    // reader turns "the extractor did not say" into "certain, and wrong" — on a
    // value that ORDERS suggestions.
    expect(
      normaliseTextileAnalysis({ ...PAYLOAD, confidence: undefined }, {
        source: "internal_extraction",
      }).confidence
    ).toBeNull()

    expect(
      normaliseTextileAnalysis({ ...PAYLOAD, confidence: null }, {
        source: "internal_extraction",
      }).confidence
    ).toBeNull()

    // 0 IS an answer, and a different one from "did not say".
    expect(
      normaliseTextileAnalysis({ ...PAYLOAD, confidence: 0 }, {
        source: "internal_extraction",
      }).confidence
    ).toBe(0)

    expect(
      normaliseTextileAnalysis(PAYLOAD, { source: "internal_extraction" })
        .confidence
    ).toBe(0.62)
  })

  it("keeps prose as prose and empty lists as null", () => {
    const out = normaliseTextileAnalysis(PAYLOAD, {
      source: "storefront_reference",
    })

    expect(out.title).toBe(PAYLOAD.title)
    expect(out.suggested_price).toEqual({ amount: 65, currency: "USD" })
    expect(out.season).toEqual(["Spring", "Fall"])
    // `care_instructions: []` carries no information — null says so.
    expect(out.care_instructions).toBeNull()
    expect(out.source).toBe("storefront_reference")
  })

  it("🔴 keeps unknown keys in `raw` instead of dropping them", () => {
    const out = normaliseTextileAnalysis(
      { ...PAYLOAD, weave_density: "180 gsm", brand_guess: "unknown" },
      { source: "internal_extraction" }
    )
    // A model that starts emitting a new field must not lose it before someone
    // types it — and nobody should be tempted back to `metadata`.
    expect(out.raw).toEqual({ weave_density: "180 gsm", brand_guess: "unknown" })
    // Named keys never leak into raw.
    expect(out.raw?.title).toBeUndefined()
  })

  it("survives a null payload", () => {
    const out = normaliseTextileAnalysis(null, { source: "manual" })
    expect(out.cloth_type).toBeNull()
    expect(out.confidence).toBeNull()
    expect(out.raw).toBeNull()
    expect(out.source).toBe("manual")
  })
})
