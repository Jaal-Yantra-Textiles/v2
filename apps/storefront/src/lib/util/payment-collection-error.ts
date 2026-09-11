/**
 * Telling "your link is wrong" apart from "our backend is down" (#1985 / #1979
 * slice 1b).
 *
 * ## Why this exists
 *
 * `preparePaymentCollection` used to be `try { … } catch { return null }`, and
 * the page rendered one message for null:
 *
 * > This payment link is not valid.
 *
 * That sentence is a lie in every case except one. A backend that is down,
 * unreachable, mid-deploy, or 500ing produces exactly the same `null` as a
 * genuinely dead link — so we told a paying customer their link was bad when
 * the fault was ours. It was observed live: the storefront deployed before the
 * backend, and a perfectly valid link read as invalid.
 *
 * ⚠️ It is also the worst possible lie to tell HERE. The buyer's next move is
 * to give up or to email asking for a new link, and the link they have is fine
 * — so the "fix" cannot work and the money does not arrive.
 *
 * ## The one case that really is the link's fault
 *
 * `POST /store/payment-collections/:id/prepare` answers **404** — and only 404
 * — for an id that is not a live collection:
 *
 * ```ts
 * res.status(404).json({ message: "This payment link is not valid." })
 * ```
 *
 * So 404 is the ONLY status that may blame the link. Everything else is ours
 * until proven otherwise, which is the safe direction to be wrong in: telling
 * someone "try again shortly" when their link is genuinely dead costs a few
 * minutes, while telling them "your link is invalid" when our backend is
 * restarting costs the sale.
 */
export type PrepareFailure = "not_found" | "unavailable"

/**
 * PURE: whose fault a failed `prepare` was. Exported for tests.
 *
 * ⚠️ A genuinely unreachable backend does NOT produce a `FetchError`. The
 * Medusa JS SDK only constructs one from a real HTTP response; when the
 * connection itself fails, the underlying `fetch` throws a `TypeError`
 * ("fetch failed") with **no `status` at all**. So "no status" is the shape of
 * the exact outage this function was written for, and it must read as
 * `unavailable` — never as a missing link.
 */
export function classifyPrepareFailure(error: unknown): PrepareFailure {
  const status = Number((error as { status?: unknown })?.status)
  return status === 404 ? "not_found" : "unavailable"
}
