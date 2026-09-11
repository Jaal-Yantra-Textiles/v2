import { describe, expect, it } from "vitest"

import { classifyPrepareFailure } from "../payment-collection-error"

/**
 * 🔴 The page used to render "This payment link is not valid" for EVERY
 * failure, including our own outages — telling a paying customer their link was
 * bad when the fault was ours. Observed live when the storefront deployed ahead
 * of the backend.
 *
 * Only a 404 from `prepare` may blame the link; that is the single status the
 * backend uses for an id that is not a live collection.
 */
describe("classifyPrepareFailure", () => {
  it("blames the link ONLY on a 404", () => {
    expect(classifyPrepareFailure({ status: 404 })).toBe("not_found")
    // The SDK's FetchError carries status as a number; a string must still work
    // rather than silently falling through to "unavailable".
    expect(classifyPrepareFailure({ status: "404" })).toBe("not_found")
  })

  it("🔴 treats a connection failure — which has NO status — as ours", () => {
    /*
     * THE CASE THIS EXISTS FOR. The SDK only builds a FetchError from a real
     * HTTP response; when the backend is unreachable the underlying fetch
     * throws a bare TypeError with no status. Reading that as "not found" is
     * exactly the bug.
     */
    expect(classifyPrepareFailure(new TypeError("fetch failed"))).toBe(
      "unavailable"
    )
    expect(classifyPrepareFailure(new Error("ECONNREFUSED"))).toBe("unavailable")
    expect(classifyPrepareFailure({})).toBe("unavailable")
    expect(classifyPrepareFailure(undefined)).toBe("unavailable")
    expect(classifyPrepareFailure(null)).toBe("unavailable")
  })

  it("treats a server error as ours", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyPrepareFailure({ status })).toBe("unavailable")
    }
  })

  it("does not blame the link for other 4xx", () => {
    /*
     * A 401/403 means our publishable key or CORS is misconfigured, and a 400
     * means we sent a bad request — the buyer's link is fine in all of them.
     * Being wrong towards "try again shortly" costs minutes; being wrong the
     * other way costs the sale.
     */
    for (const status of [400, 401, 403, 405, 429]) {
      expect(classifyPrepareFailure({ status })).toBe("unavailable")
    }
  })
})
