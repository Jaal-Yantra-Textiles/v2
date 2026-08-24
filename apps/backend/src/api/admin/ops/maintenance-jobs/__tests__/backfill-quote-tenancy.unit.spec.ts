import { MAINTENANCE_JOBS } from "../registry"
import {
  backfillQuoteTenancyJob,
  resolveQuoteStore,
} from "../backfill-quote-tenancy-job"

/**
 * The rule that matters here is what the job REFUSES to do (#1439 S15).
 *
 * Tagging a quote with the wrong store is worse than leaving it untagged: the
 * tenant guard would then hide it from the buyer it was sent to and show it on
 * a shop that never sold it — causing exactly the failure the guard exists to
 * prevent, and doing so silently, because a tagged row looks correct.
 *
 * So the resolution is deliberately narrow: exactly one store is an answer,
 * anything else is a report.
 */
describe("resolveQuoteStore", () => {
  it("resolves when the partner owns exactly one store", () => {
    expect(resolveQuoteStore({ partnerStoreIds: ["store_a"] })).toEqual({
      store_id: "store_a",
      reason: "resolved",
    })
  })

  it("🔴 refuses to pick when the partner owns several", () => {
    expect(
      resolveQuoteStore({ partnerStoreIds: ["store_a", "store_b"] })
    ).toEqual({ store_id: null, reason: "ambiguous" })
  })

  it("reports a partner with no store rather than inventing one", () => {
    expect(resolveQuoteStore({ partnerStoreIds: [] })).toEqual({
      store_id: null,
      reason: "no_store",
    })
  })

  it("treats a duplicated store id as one store, not as ambiguity", () => {
    // The same store arriving twice through a link read is not a second
    // storefront, and refusing it would strand a perfectly resolvable quote.
    expect(
      resolveQuoteStore({ partnerStoreIds: ["store_a", "store_a"] })
    ).toEqual({ store_id: "store_a", reason: "resolved" })
  })

  it("ignores empty ids rather than counting them as a store", () => {
    expect(
      resolveQuoteStore({ partnerStoreIds: ["", "store_a"] as string[] })
    ).toEqual({ store_id: "store_a", reason: "resolved" })
  })
})

describe("backfillQuoteTenancyJob", () => {
  it("is registered, or it cannot be run from the UI or over MCP", () => {
    expect(MAINTENANCE_JOBS).toContain(backfillQuoteTenancyJob)
  })

  it("declares the params the runner passes", () => {
    const names = backfillQuoteTenancyJob.params?.map((p: any) => p.name) ?? []
    expect(names).toEqual(expect.arrayContaining(["partner_id", "limit"]))
  })

  it("says in its own description that it never guesses", () => {
    // The description is what an operator and an assistant read before running
    // it. The narrowness is the safety property, so it has to be stated there
    // and not only in the code.
    expect(backfillQuoteTenancyJob.description).toMatch(/never guessed|reported, never guessed/i)
  })
})
