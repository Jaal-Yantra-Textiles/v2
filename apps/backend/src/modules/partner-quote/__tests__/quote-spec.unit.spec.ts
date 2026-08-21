import { composeLineSpec, resolveQuoteSpecs } from "../lib/quote-spec"

/**
 * The spec on a quote (#1428) — facts, never choices.
 *
 * The load-bearing assertion is the negative one: a quote is frozen against
 * SPECIFIC variants, so a colour palette rendered beside them would tell a
 * procurement buyer they may pick a colour when neither this page nor the
 * price list behind it can honour that.
 */

const SPEC = {
  id: "spec_1",
  product_id: "prod_a",
  weave_technique: "pashmina-plain",
  weave_label: null,
  params: { gsm: 90, ends_per_inch: 72, unlisted_param: 7 },
  finishes: ["hand wash cold", "dry flat"],
  notes: "Workshop: watch the selvedge on loom 3.",
  accepting_custom_orders: true,
  colors: [{ id: "c1", name: "Natural", available: true }],
  options: [{ id: "o1", key: "border", label: "Border", values: [] }],
  fields: [
    { key: "origin", label: "Origin", value: "Kanihama, Kashmir", order: 1 },
    { key: "loom", label: "Loom", value: null, order: 0 },
  ],
}

describe("composeLineSpec", () => {
  it("labels a known param from the registry, with its unit and glyph", () => {
    const spec = composeLineSpec(SPEC)!
    const gsm = spec.rows.find((r) => r.key === "gsm")

    // "Weight · 90 GSM", not "gsm · 90". The label, unit and icon come from
    // weaving-techniques.ts, where the param is defined.
    expect(gsm).toEqual({
      key: "gsm",
      label: "Weight",
      value: "90",
      unit: "GSM",
      icon: "weight",
    })
    expect(spec.weave_label).toBe("Pashmina (plain)")
  })

  it("still renders a param the registry has never heard of", () => {
    const row = composeLineSpec(SPEC)!.rows.find((r) => r.key === "unlisted_param")

    // A spec written against a newer registry than this build must be a plain
    // row, not a blank space and not a crash.
    expect(row).toEqual({
      key: "unlisted_param",
      label: "Unlisted param",
      value: "7",
      unit: null,
      icon: "note",
    })
  })

  it("carries the partner's free extra fields, in their order, skipping empties", () => {
    const spec = composeLineSpec(SPEC)!
    expect(spec.rows.map((r) => r.key)).toContain("origin")
    // `loom` has no value — an empty row on a signed-off document reads as
    // missing data.
    expect(spec.rows.map((r) => r.key)).not.toContain("loom")
  })

  it("returns the FACTS and drops every made-to-order CHOICE", () => {
    const spec = composeLineSpec(SPEC) as any

    expect(spec.finishes).toEqual(["hand wash cold", "dry flat"])
    // 🔴 The whole point. A quote cannot honour a colour pick.
    expect(spec.colors).toBeUndefined()
    expect(spec.options).toBeUndefined()
    expect(spec.accepting_custom_orders).toBeUndefined()
    // Workshop notes are not customer copy — same rule the store spec route
    // already applies.
    expect(JSON.stringify(spec)).not.toMatch(/selvedge/)
  })

  it("is null when there is nothing worth heading a block with", () => {
    expect(composeLineSpec(null)).toBeNull()
    expect(
      composeLineSpec({ params: {}, finishes: [], fields: [], weave_technique: null })
    ).toBeNull()
  })
})

describe("resolveQuoteSpecs", () => {
  const scopeWith = (specs: any[], opts: { throws?: boolean } = {}) => ({
    resolve: () => ({
      listProductSpecs: async (filters: any, config: any) => {
        if (opts.throws) throw new Error("module unavailable")
        expect(filters.product_id).toEqual(["prod_a", "prod_b"])
        // Only `fields`. Loading colours and options here would invite a later
        // caller to render them.
        expect(config.relations).toEqual(["fields"])
        return specs
      },
    }),
  })

  it("reads a whole basket in one call, keyed by product", async () => {
    const byProduct = await resolveQuoteSpecs(
      scopeWith([SPEC]) as any,
      ["prod_a", "prod_b", "prod_a"]
    )

    expect(byProduct.get("prod_a")?.weave_label).toBe("Pashmina (plain)")
    // prod_b simply has no spec — the normal state for most products.
    expect(byProduct.get("prod_b")).toBeUndefined()
  })

  it("renders the lines without a spec block when the module falls over", async () => {
    const byProduct = await resolveQuoteSpecs(
      scopeWith([], { throws: true }) as any,
      ["prod_a", "prod_b"]
    )
    expect(byProduct.size).toBe(0)
  })

  it("does not resolve anything for a basket with no products", async () => {
    const scope = { resolve: () => { throw new Error("must not resolve") } }
    expect((await resolveQuoteSpecs(scope as any, [])).size).toBe(0)
  })
})
