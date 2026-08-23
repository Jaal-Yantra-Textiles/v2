/**
 * Events the quote path emits (#1439).
 *
 * ## Why these are constants and not string literals at the emit site
 *
 * Emitting an event is only half of making it usable. A visual flow can only be
 * triggered by an event named in `visual-flow-event-trigger`'s `config.event`
 * allowlist, and Medusa reports nothing at all when an event is missing from
 * it: the emit succeeds, the flow sits active with that event as its trigger,
 * executing the flow by hand works perfectly, and production does nothing.
 *
 * That is exactly what happened here — three real mints triggered zero flow
 * executions while a hand-fired run of the same flow completed cleanly.
 *
 * So the names live in one place and `quote-events-are-subscribed.unit.spec.ts`
 * asserts the subscriber carries every one of them. Adding an event here
 * without wiring it there fails that test, which is the only signal this
 * failure mode ever produces.
 */
export const PARTNER_QUOTE_EVENTS = {
  /**
   * A quote was minted and its buyer link exists. Carries `buyer_url`, because
   * a flow that cannot name the link can send nothing useful. Emitted even when
   * the built-in email fails — recovering a failed delivery is precisely a job
   * for a flow.
   */
  MINTED: "partner_quote.minted",
  /**
   * A buyer accepted, and there is now a cart and a payment schedule. Fires on
   * the FRESH acceptance only: a second click resolves to `already_accepted`
   * and emits nothing, or a flow would mail the partner once per page refresh.
   */
  ACCEPTED: "partner_quote.accepted",
} as const

export const PARTNER_QUOTE_EVENT_NAMES: readonly string[] = Object.values(
  PARTNER_QUOTE_EVENTS
)
