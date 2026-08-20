import {
  withPriceIds,
  BATCH_VARIANT_FIELDS,
} from "../batch-partner-variants"

/**
 * #1370 — the field set a caller can and cannot shrink.
 *
 * Narrowing `?fields=` is the point of the change: the one caller of this route
 * discards the response body entirely and the enrichment that builds it ran
 * 377ms-6002ms on prod. But the FX fanout is driven by the price ids that same
 * enrichment returns, and an update that ADDS a currency sends no price id — so
 * that id exists only in the re-read. Narrow past it and prices stop converting
 * into the store's other currencies, silently.
 *
 * These tests are the guard on that invariant, not on the field list's contents.
 */
describe("withPriceIds", () => {
  it("falls back to the full default when the caller asks for nothing", () => {
    expect(withPriceIds(undefined)).toBe(BATCH_VARIANT_FIELDS)
    expect(withPriceIds([])).toBe(BATCH_VARIANT_FIELDS)
  })

  it("adds price ids to a narrow set that would have starved the fanout", () => {
    expect(withPriceIds(["id"])).toEqual(["id", "price_set.prices.id"])
  })

  it("leaves an already-pre-remapped price field alone", () => {
    const fields = ["id", "price_set.prices.*"]
    expect(withPriceIds(fields)).toEqual(fields)
  })

  it("recognises core's own `*prices` spelling and does not double up", () => {
    // refetchBatchVariants runs remapKeysForVariant, so `*prices` becomes
    // price_set.prices — appending our own would be redundant.
    const fields = ["id", "*prices"]
    expect(withPriceIds(fields)).toEqual(fields)
  })

  it("recognises the un-starred `prices.` spelling too", () => {
    const fields = ["id", "prices.price_rules.value"]
    expect(withPriceIds(fields)).toEqual(fields)
  })

  it("keeps the default set intact — it already carries prices", () => {
    expect(withPriceIds([...BATCH_VARIANT_FIELDS])).toEqual(BATCH_VARIANT_FIELDS)
  })

  it("never drops what the caller asked for", () => {
    const asked = ["id", "title", "sku"]
    const out = withPriceIds(asked)
    for (const f of asked) {
      expect(out).toContain(f)
    }
  })
})
