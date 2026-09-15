import { describe, expect, it } from "vitest"

import {
  candidateOptions,
  chooseCandidate,
  needsVariantChoice,
  resolveDesignPick,
} from "../quote-design-candidates"

/**
 * #1970 — a design sold as several variants.
 *
 * The cases that matter are the ones where picking something plausible would
 * put the wrong size on a quote a buyer signs.
 */

/** The shape `design-lines.ts` returns for a multi-variant design. */
const MULTI = {
  variant_id: null,
  product_id: null,
  candidates: [
    {
      variant_id: "var_s",
      title: "S",
      sku: "KAS-S",
      product_id: "prod_1",
      product_title: "Kashida Shawl",
    },
    {
      variant_id: "var_m",
      title: "M",
      sku: "KAS-M",
      product_id: "prod_1",
      product_title: "Kashida Shawl",
    },
  ],
}

/** Exactly one variant backs it, so the backend already resolved it. */
const RESOLVED = {
  variant_id: "var_only",
  product_id: "prod_2",
  candidates: [
    {
      variant_id: "var_only",
      title: "M",
      sku: "PAS-M",
      product_id: "prod_2",
      product_title: "Pashmina Stole",
    },
  ],
}

/** Nothing backs it yet — the made-to-order case. */
const UNBACKED = { variant_id: null, product_id: null, candidates: [] }

describe("needsVariantChoice", () => {
  it("is true when several variants back the design", () => {
    expect(needsVariantChoice(MULTI)).toBe(true)
  })

  it("is false once the backend has resolved one", () => {
    expect(needsVariantChoice(RESOLVED)).toBe(false)
  })

  it("🔴 is false when NOTHING backs it — that is made-to-order, not a choice", () => {
    // Collapsing the two would offer an empty dropdown on a design that needs
    // a product minted instead.
    expect(needsVariantChoice(UNBACKED)).toBe(false)
    expect(needsVariantChoice({ candidates: null })).toBe(false)
    expect(needsVariantChoice(null)).toBe(false)
    expect(needsVariantChoice(undefined)).toBe(false)
  })
})

describe("resolveDesignPick", () => {
  it("passes an already-resolved design straight through", () => {
    expect(resolveDesignPick(RESOLVED)).toEqual({
      variant_id: "var_only",
      product_id: "prod_2",
    })
  })

  it("uses the candidate the partner chose", () => {
    expect(resolveDesignPick(MULTI, "var_m")).toEqual({
      variant_id: "var_m",
      product_id: "prod_1",
    })
  })

  it("🔴 refuses until a choice is made — it never falls back to row 0", () => {
    // Quoting candidates[0] would put a size nobody chose on a signed document.
    expect(resolveDesignPick(MULTI)).toBeNull()
    expect(resolveDesignPick(MULTI, null)).toBeNull()
    expect(resolveDesignPick(MULTI, "")).toBeNull()
  })

  it("refuses a variant the backend did not offer", () => {
    expect(resolveDesignPick(MULTI, "var_from_nowhere")).toBeNull()
  })

  it("🔴 refuses a candidate with no product_id", () => {
    // toggleDesign needs both ids: it keys the basket by variant AND pushes the
    // product into product_ids. One without the other leaves a quantity keyed
    // to a variant the next step cannot find.
    const noProduct = {
      variant_id: null,
      product_id: null,
      candidates: [
        { variant_id: "var_a", title: "S", product_id: null },
        { variant_id: "var_b", title: "M", product_id: "prod_9" },
      ],
    }
    expect(resolveDesignPick(noProduct, "var_a")).toBeNull()
    expect(resolveDesignPick(noProduct, "var_b")).toEqual({
      variant_id: "var_b",
      product_id: "prod_9",
    })
  })

  it("refuses an unbacked design whatever is passed", () => {
    expect(resolveDesignPick(UNBACKED, "var_s")).toBeNull()
    expect(resolveDesignPick(null, "var_s")).toBeNull()
  })
})

describe("candidateOptions", () => {
  it("labels by title, falling back to sku then id", () => {
    expect(
      candidateOptions({
        candidates: [
          { variant_id: "v1", title: "S", sku: "A" },
          { variant_id: "v2", title: null, sku: "B" },
          { variant_id: "v3", title: null, sku: null },
        ],
      })
    ).toEqual([
      { value: "v1", label: "S" },
      { value: "v2", label: "B" },
      { value: "v3", label: "v3" },
    ])
  })

  it("is empty when there is nothing to offer", () => {
    expect(candidateOptions(UNBACKED)).toEqual([])
    expect(candidateOptions(null)).toEqual([])
  })
})

describe("chooseCandidate", () => {
  it("records a choice", () => {
    expect(chooseCandidate({}, "des_1", "var_m")).toEqual({ des_1: "var_m" })
  })

  it("🔴 clearing DELETES the key rather than writing an empty string", () => {
    const next = chooseCandidate({ des_1: "var_m" }, "des_1", null)
    expect(next).toEqual({})
    expect("des_1" in next).toBe(false)
  })

  it("returns a new object so React sees the change", () => {
    const current = { des_1: "var_s" }
    const next = chooseCandidate(current, "des_2", "var_m")
    expect(next).not.toBe(current)
    expect(current).toEqual({ des_1: "var_s" })
  })
})
