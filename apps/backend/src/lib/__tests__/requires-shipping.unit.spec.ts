import {
  lineItemIdsNeedingShippingFlag,
  resolveItemShippingProfileId,
} from "../requires-shipping"

/** A product that carries a shipping profile — the only kind safe to flip. */
const profiled = { shipping_profile: { id: "sp_1" } }

describe("lineItemIdsNeedingShippingFlag (#1195)", () => {
  it("selects profiled items the derivation stamped false", () => {
    expect(
      lineItemIdsNeedingShippingFlag([
        { id: "li_1", requires_shipping: false, product: profiled },
        { id: "li_2", requires_shipping: false, product: profiled },
      ])
    ).toEqual(["li_1", "li_2"])
  })

  it("leaves correct items alone (idempotent re-run)", () => {
    expect(
      lineItemIdsNeedingShippingFlag([
        { id: "li_1", requires_shipping: true, product: profiled },
        { id: "li_2", requires_shipping: false, product: profiled },
      ])
    ).toEqual(["li_2"])
  })

  it("NEVER flips an item whose product has no shipping profile", () => {
    // create-fulfillment.js:78-83 compares the product's profile against the
    // chosen option's; with no profile that check can never pass, so the flag
    // would make the item unfulfillable rather than shippable.
    expect(
      lineItemIdsNeedingShippingFlag([
        { id: "li_1", requires_shipping: false, product: {} },
        { id: "li_2", requires_shipping: false },
        { id: "li_3", requires_shipping: false, product: { shipping_profile: null } },
      ])
    ).toEqual([])
  })

  it("only acts on an explicit false, never an absent flag", () => {
    expect(
      lineItemIdsNeedingShippingFlag([
        { id: "li_1", product: profiled },
        { id: "li_2", requires_shipping: null, product: profiled },
        { id: "li_3", requires_shipping: undefined, product: profiled },
      ])
    ).toEqual([])
  })

  it("skips rows with no id", () => {
    expect(
      lineItemIdsNeedingShippingFlag([
        { requires_shipping: false, product: profiled },
      ])
    ).toEqual([])
  })

  it("tolerates empty / missing input", () => {
    expect(lineItemIdsNeedingShippingFlag([])).toEqual([])
    expect(lineItemIdsNeedingShippingFlag(undefined)).toEqual([])
  })
})

describe("resolveItemShippingProfileId (#1195)", () => {
  it("reads the query.graph shape (item.product)", () => {
    expect(resolveItemShippingProfileId({ product: profiled })).toBe("sp_1")
  })

  it("reads the module-retrieve shape (item.variant.product)", () => {
    expect(
      resolveItemShippingProfileId({ variant: { product: profiled } })
    ).toBe("sp_1")
  })

  it("returns undefined when there is no profile", () => {
    expect(resolveItemShippingProfileId({ product: {} })).toBeUndefined()
    expect(resolveItemShippingProfileId({})).toBeUndefined()
    expect(resolveItemShippingProfileId(null)).toBeUndefined()
  })
})
