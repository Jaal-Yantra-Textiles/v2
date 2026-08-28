import {
  anchorRefusalMessage,
  resolveCommitScope,
} from "../lib/consumption-anchor"

/**
 * The two rules that stopped being free when `design_id` became nullable.
 *
 * Context: a product-only production run (#1112) — one minted from
 * `order.fulfillment_created` for a product with no backing design — consumes
 * real material and had nowhere to record it. `design_id text not null` was
 * enforcing "every log names something" as a side effect. Dropping that NOT
 * NULL without replacing the rule would allow rows anchored to nothing.
 */
describe("anchorRefusalMessage", () => {
  it("accepts a design-only log — the 110 of 122 runs that are design-backed", () => {
    expect(anchorRefusalMessage({ design_id: "design_1" })).toBeNull()
  })

  it("accepts a product-only log — the case that could not be recorded at all", () => {
    expect(anchorRefusalMessage({ product_id: "prod_1" })).toBeNull()
  })

  it("accepts both, which 4 prod runs carry", () => {
    expect(
      anchorRefusalMessage({ design_id: "design_1", product_id: "prod_1" })
    ).toBeNull()
  })

  it("refuses a log anchored to NOTHING", () => {
    expect(anchorRefusalMessage({})).toMatch(/must name a design or a product/)
  })

  /**
   * The distinction that matters: absent and empty-string must both refuse.
   * A route that resolved `run.design_id ?? ""` and passed it straight through
   * would otherwise write an unanchored row while looking like it had a value.
   */
  it("treats an empty string as no anchor, not as an anchor", () => {
    expect(anchorRefusalMessage({ design_id: "", product_id: "" })).toMatch(
      /must name a design or a product/
    )
  })

  it("refuses explicit nulls", () => {
    expect(
      anchorRefusalMessage({ design_id: null, product_id: null })
    ).toMatch(/must name a design or a product/)
  })
})

describe("resolveCommitScope", () => {
  /**
   * 🔴 The one that would cost real money. `is_committed` is what
   * `apply-to-inventory` requires before deducting stock, and
   * `{ design_id: undefined }` is NO FILTER rather than "no rows" — so an
   * unscoped commit would mark every uncommitted log on the platform committed
   * and hand them all to the stock-deduction job.
   */
  it("REFUSES an unscoped commit rather than matching every log", () => {
    const scope = resolveCommitScope({})

    expect(scope.ok).toBe(false)
    if (scope.ok) throw new Error("expected a refusal")
    expect(scope.error).toMatch(/would commit every uncommitted log/)
  })

  it("refuses when every anchor is present but empty", () => {
    expect(
      resolveCommitScope({
        design_id: "",
        production_run_id: "",
        product_id: "",
      }).ok
    ).toBe(false)
  })

  it("scopes by design — the pre-existing caller, unchanged", () => {
    const scope = resolveCommitScope({ design_id: "design_1" })

    expect(scope).toEqual({
      ok: true,
      scope: "design design_1",
      filters: { design_id: "design_1" },
    })
  })

  it("scopes by production run — the path a product-only log needs", () => {
    const scope = resolveCommitScope({ production_run_id: "prod_run_1" })

    expect(scope).toEqual({
      ok: true,
      scope: "production run prod_run_1",
      filters: { production_run_id: "prod_run_1" },
    })
  })

  it("scopes by product", () => {
    const scope = resolveCommitScope({ product_id: "prod_1" })

    expect(scope).toEqual({
      ok: true,
      scope: "product prod_1",
      filters: { product_id: "prod_1" },
    })
  })

  /**
   * Precedence is not cosmetic: the design-scoped route already passes a
   * design_id and must keep committing exactly the same set. A caller sending
   * both must not silently narrow to the run.
   */
  it("prefers design over run and product when more than one is given", () => {
    const scope = resolveCommitScope({
      design_id: "design_1",
      production_run_id: "prod_run_1",
      product_id: "prod_1",
    })

    expect(scope.ok).toBe(true)
    if (!scope.ok) throw new Error("expected a scope")
    expect(scope.filters).toEqual({ design_id: "design_1" })
  })

  /** Exactly one filter key — never a merge, which would AND the anchors. */
  it("emits a single filter key so anchors are never ANDed together", () => {
    const scope = resolveCommitScope({
      production_run_id: "prod_run_1",
      product_id: "prod_1",
    })

    expect(scope.ok).toBe(true)
    if (!scope.ok) throw new Error("expected a scope")
    expect(Object.keys(scope.filters)).toEqual(["production_run_id"])
  })
})
