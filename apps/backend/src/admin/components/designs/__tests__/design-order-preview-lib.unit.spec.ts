import {
  canCreateOrder,
  hydrateEstimates,
  money,
  summariseEdits,
} from "../design-order-preview-lib"

const est = (over: any = {}) => ({
  design_id: "des_1",
  name: "Pashmina",
  total_estimated: 850,
  unit_price: 850,
  confidence: "estimated",
  material_cost: 500,
  production_cost: 350,
  ...over,
})

/**
 * The crash this exists to stop:
 *
 *   null is not an object (evaluating 'est.unit_price.toFixed')
 *
 * `/design-order/preview` returns `unit_price: null` when the estimator had
 * nothing to price from (#1564). The drawer typed it `number`, called
 * `.toFixed(2)` during hydration, and died before rendering a row — taking down
 * the only screen where the operator can supply the missing price.
 */
describe("hydrateEstimates", () => {
  it("does not throw on an unpriceable design", () => {
    expect(() =>
      hydrateEstimates([est({ unit_price: null, total_estimated: null })] as any)
    ).not.toThrow()
  })

  /** Empty, never "0.00" — a zero is a decision to give something away. */
  it("leaves an unpriced line's field EMPTY rather than zero", () => {
    const form = hydrateEstimates([
      est({ unit_price: null, total_estimated: null }),
    ] as any)

    expect(form.des_1.unitPrice).toBe("")
  })

  it("fills a priced line normally", () => {
    const form = hydrateEstimates([est()] as any)

    expect(form.des_1).toEqual({
      material: "500.00",
      production: "350.00",
      unitPrice: "850.00",
    })
  })

  it("survives a missing cost component", () => {
    const form = hydrateEstimates([
      est({ material_cost: null, production_cost: undefined }),
    ] as any)

    expect(form.des_1.material).toBe("")
    expect(form.des_1.production).toBe("")
  })
})

describe("money", () => {
  it("is empty for anything that is not a finite number", () => {
    expect(money(null)).toBe("")
    expect(money(undefined)).toBe("")
    expect(money(NaN)).toBe("")
  })

  it("keeps a real zero visible", () => {
    // A stored 0 IS a decision someone made; only ABSENCE is blank.
    expect(money(0)).toBe("0.00")
  })
})

describe("summariseEdits", () => {
  it("names an untouched unpriceable line as unpriced", () => {
    const estimates = [est({ unit_price: null, total_estimated: null })] as any
    const summary = summariseEdits(estimates, hydrateEstimates(estimates))

    expect(summary.unpriced).toEqual(["des_1"])
    expect(summary.computedTotal).toBe(0)
    expect(summary.priceOverrides).toEqual({})
  })

  /**
   * 🔴 A blank is not a zero. Counting it as 0 produced a total that looked
   * complete and a Create the workflow then refused, after the click.
   */
  it("never adds a blank line into the total", () => {
    const estimates = [est(), est({ design_id: "des_2", unit_price: null })] as any
    const summary = summariseEdits(estimates, {
      des_1: { material: "500.00", production: "350.00", unitPrice: "850.00" },
      des_2: { material: "", production: "", unitPrice: "" },
    })

    expect(summary.computedTotal).toBe(850)
    expect(summary.unpriced).toEqual(["des_2"])
  })

  it("sends a typed price for an unpriceable line as an override", () => {
    const estimates = [est({ unit_price: null, total_estimated: null })] as any
    const summary = summariseEdits(estimates, {
      des_1: { material: "", production: "", unitPrice: "1200" },
    })

    expect(summary.priceOverrides).toEqual({ des_1: 1200 })
    expect(summary.unpriced).toEqual([])
    expect(summary.hasChanges).toBe(true)
  })

  it("sends no override when the estimate is accepted as-is", () => {
    const estimates = [est()] as any
    const summary = summariseEdits(estimates, hydrateEstimates(estimates))

    expect(summary.priceOverrides).toEqual({})
    expect(summary.hasChanges).toBe(false)
    expect(summary.computedTotal).toBe(850)
  })

  it("treats a zero or negative entry as missing, not as free", () => {
    const estimates = [est(), est({ design_id: "des_2" })] as any
    const summary = summariseEdits(estimates, {
      des_1: { material: "", production: "", unitPrice: "0" },
      des_2: { material: "", production: "", unitPrice: "-5" },
    })

    expect(summary.unpriced).toEqual(["des_1", "des_2"])
    expect(summary.computedTotal).toBe(0)
  })
})

describe("canCreateOrder", () => {
  /**
   * The old gate was `computedTotal === 0`, which let a batch through with one
   * priced design and one blank — and the workflow threw on the blank.
   */
  it("refuses while ANY line is unpriced, even when the total is not zero", () => {
    const estimates = [est(), est({ design_id: "des_2", unit_price: null })] as any
    const summary = summariseEdits(estimates, {
      des_1: { material: "", production: "", unitPrice: "850" },
      des_2: { material: "", production: "", unitPrice: "" },
    })

    expect(summary.computedTotal).toBe(850)
    expect(canCreateOrder(summary)).toBe(false)
  })

  it("allows a fully priced batch", () => {
    const estimates = [est(), est({ design_id: "des_2", unit_price: null })] as any
    const summary = summariseEdits(estimates, {
      des_1: { material: "", production: "", unitPrice: "850" },
      des_2: { material: "", production: "", unitPrice: "1200" },
    })

    expect(canCreateOrder(summary)).toBe(true)
    expect(summary.computedTotal).toBe(2050)
  })
})
