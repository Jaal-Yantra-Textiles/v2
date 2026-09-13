import {
  currencyIsSellable,
  partnerStoreIdsFrom,
  pickHouseStore,
  storeCurrencies,
  storeDefaultCurrency,
} from "../house-store"

const partner = (id: string, partner_id: string, currencies: string[] = ["inr"]) => ({
  id,
  metadata: { partner_id },
  supported_currencies: currencies.map((c, i) => ({
    currency_code: c,
    is_default: i === 0,
  })),
})

const house = (id = "store_house", currencies: string[] = ["eur", "inr"]) => ({
  id,
  metadata: null,
  supported_currencies: currencies.map((c, i) => ({
    currency_code: c,
    is_default: i === 0,
  })),
})

/**
 * #2029 item 2 — the fact "this store belongs to a partner" has a TYPED home
 * (`links/partner-stores-link.ts`), and this used to read a metadata blob
 * instead. The link now decides; metadata survives only as a fallback for the
 * one case where the link cannot be trusted.
 */
describe("pickHouseStore — the link decides", () => {
  it("uses the link, not the blob, when the link says anything", () => {
    const stores = [partner("s1", "p1"), house(), partner("s2", "p2")]
    const ids = new Set(["s1", "s2"])
    expect(pickHouseStore(stores, ids)?.id).toBe("store_house")
  })

  /**
   * The whole point of typing it. A store whose blob was never tagged — an
   * older tenant, or one created by a path that forgot — is still a partner's
   * store, and the link knows. Under the old read it looked like a SECOND house
   * store, which made the answer ambiguous and silently disabled the currency
   * gate for everyone.
   */
  it("catches a partner store whose metadata was never tagged", () => {
    const untagged = { id: "s_untagged", metadata: null, supported_currencies: [] }
    const stores = [house(), untagged]
    // Blob-only: two ownerless stores -> ambiguous -> null -> gate off.
    expect(pickHouseStore(stores)).toBeNull()
    // Link: the untagged store has an owner, so the house store is unambiguous.
    expect(pickHouseStore(stores, new Set(["s_untagged"]))?.id).toBe("store_house")
  })

  /**
   * 🔴 The trap `partner-stores-link.ts` documents about itself: an empty link
   * result is indistinguishable from "no store belongs to a partner". Believing
   * it would make every store a house store — ambiguous, null, gate off
   * platform-wide — so an empty set falls back to the blob instead.
   */
  it("falls back to metadata when the link says NOTHING", () => {
    const stores = [partner("s1", "p1"), house(), partner("s2", "p2")]
    expect(pickHouseStore(stores, new Set())?.id).toBe("store_house")
    expect(pickHouseStore(stores, null)?.id).toBe("store_house")
    expect(pickHouseStore(stores, undefined)?.id).toBe("store_house")
  })

  it("still refuses to guess when the link leaves it ambiguous", () => {
    const stores = [house("h1"), house("h2"), partner("s1", "p1")]
    expect(pickHouseStore(stores, new Set(["s1"]))).toBeNull()
    // And when the link accounts for every store, there is no house at all.
    expect(pickHouseStore(stores, new Set(["h1", "h2", "s1"]))).toBeNull()
  })
})

describe("partnerStoreIdsFrom", () => {
  it("flattens the partner -> stores hop", () => {
    expect(
      partnerStoreIdsFrom([
        { id: "p1", stores: [{ id: "s1" }, { id: "s2" }] },
        { id: "p2", stores: [{ id: "s3" }] },
      ])
    ).toEqual(new Set(["s1", "s2", "s3"]))
  })

  it("survives partners with no stores, and junk", () => {
    expect(partnerStoreIdsFrom([{ id: "p1" }, { id: "p2", stores: [] }])).toEqual(
      new Set()
    )
    expect(partnerStoreIdsFrom(null)).toEqual(new Set())
    expect(
      partnerStoreIdsFrom([{ id: "p1", stores: [{ id: "" }, {}, { id: "  " }] }])
    ).toEqual(new Set())
  })
})

/**
 * 🔴 The read this replaces was `stores?.[0]` against a 13-row multi-tenant
 * table, so the currency an approval stamped was a LOTTERY across tenants —
 * eleven default to INR, one to AUD, two to EUR. That is why 14 approved
 * products came out in INR and exactly one came out in EUR at ~110× (#1979).
 */
describe("pickHouseStore", () => {
  it("picks the store that is not a partner tenant", () => {
    const stores = [partner("s1", "p1"), house(), partner("s2", "p2")]
    expect(pickHouseStore(stores)?.id).toBe("store_house")
  })

  it("does NOT just take the first row", () => {
    // The whole defect in one assertion: row order must not decide.
    const stores = [partner("s_first", "p1"), house("store_house")]
    expect(pickHouseStore(stores)?.id).not.toBe("s_first")
  })

  it("returns null when NO store lacks a partner id", () => {
    // Ambiguous. Guessing here would re-create the bug in a new place.
    expect(pickHouseStore([partner("s1", "p1"), partner("s2", "p2")])).toBeNull()
  })

  it("returns null when MORE THAN ONE store lacks a partner id", () => {
    expect(pickHouseStore([house("h1"), house("h2")])).toBeNull()
  })

  it("treats a blank or whitespace partner_id as no partner id", () => {
    /*
     * '' is falsy but is not null, and "  " is truthy — the pair of shapes that
     * have defeated guards elsewhere in this codebase. Both mean "not a tenant".
     */
    expect(pickHouseStore([{ id: "a", metadata: { partner_id: "" } }])?.id).toBe("a")
    expect(pickHouseStore([{ id: "b", metadata: { partner_id: "   " } }])?.id).toBe("b")
  })

  it("survives missing metadata entirely", () => {
    expect(pickHouseStore([{ id: "a" } as any])?.id).toBe("a")
    expect(pickHouseStore([])).toBeNull()
    expect(pickHouseStore(null)).toBeNull()
  })
})

describe("storeCurrencies / storeDefaultCurrency", () => {
  it("lowercases and drops blanks", () => {
    expect(storeCurrencies(house("h", ["EUR", "inr"]))).toEqual(["eur", "inr"])
    expect(storeCurrencies({ supported_currencies: [{ currency_code: "  " }] })).toEqual(
      []
    )
    expect(storeCurrencies({})).toEqual([])
  })

  it("reads the flagged default, not the first entry", () => {
    const s = {
      supported_currencies: [
        { currency_code: "aed", is_default: false },
        { currency_code: "EUR", is_default: true },
      ],
    }
    // On prod JYT Medu Store lists 'aed' first and defaults to 'eur'.
    expect(storeDefaultCurrency(s)).toBe("eur")
    expect(storeDefaultCurrency({ supported_currencies: [] })).toBeNull()
  })
})

describe("currencyIsSellable", () => {
  const jytMedu = { id: "h", currencies: ["aed", "eur", "inr"], defaultCurrency: "eur" }
  const leCiricotte = { id: "l", currencies: ["eur", "gbp"], defaultCurrency: "eur" }

  it("passes a currency the house store enables", () => {
    // INR is enabled on JYT Medu Store, so an INR-costed design is sellable.
    expect(currencyIsSellable("inr", jytMedu)).toBe(true)
    expect(currencyIsSellable("INR", jytMedu)).toBe(true)
  })

  it("flags a currency the house store does not enable", () => {
    // The live instance: Le Ciricotte does not enable INR at all.
    expect(currencyIsSellable("inr", leCiricotte)).toBe(false)
  })

  it("🔴 abstains rather than objecting when the house store is unknown", () => {
    /*
     * null means "could not read / ambiguous". Returning false there would turn
     * an unreadable store into a warning about a price that may be perfectly
     * fine — noise that trains the operator to ignore the real one.
     */
    expect(currencyIsSellable("inr", null)).toBe(true)
    expect(currencyIsSellable("inr", { id: "x", currencies: [], defaultCurrency: null })).toBe(
      true
    )
  })

  it("is a guard and nothing more — it never returns a replacement", () => {
    /*
     * Documented as a test because the tempting 'fix' — swapping in the store's
     * default when the cost currency is not enabled — IS #1979: it silently
     * re-denominates ₹2,634.75 as €2,634.75.
     */
    expect(typeof currencyIsSellable("inr", leCiricotte)).toBe("boolean")
  })
})
