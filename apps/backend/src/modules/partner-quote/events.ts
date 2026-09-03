/**
 * Events the quote path emits (#1439) — and, because the guard this file feeds
 * is the only signal this failure mode ever produces, the CRM engagement-sweep
 * names the subscriber must also carry (#1355).
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

/**
 * CRM engagement-sweep events (#1355) — the same trap again, so the same guard
 * covers them.
 *
 * `crm-engagement-sweep` (the maintenance job the daily `sweep-crm-engagement`
 * schedule runs) is the sole emitter of these four names, and it emits only on
 * a real engagement-state TRANSITION. They were emitted while absent from the
 * subscriber's allowlist, so every flow triggering on `crm.*` sat inert — the
 * exact failure the quote constants above were centralized to prevent.
 *
 * The emitter keeps its own local name map (`EVENT_BY_STATE` in
 * `api/admin/ops/maintenance-jobs/crm-engagement-sweep-job.ts`) and is not
 * coupled to this module, so these constants are the guard's copy, not the
 * emitter's: `quote-events-are-subscribed.unit.spec.ts` asserts the subscriber
 * carries every one of them. Adding a new crm.* event to the emitter means
 * adding it here as well — that second line is the whole checklist, and
 * skipping it is how #1355 happened.
 */
export const CRM_ENGAGEMENT_EVENTS = {
  /** A contact's follow-up date passed with nobody having acted. */
  FOLLOW_UP_DUE: "crm.follow_up_due",
  /** A contact went quiet long enough to count as stalled. */
  STALLED: "crm.contact_stalled",
  /** An inbound reply moved the contact into `in_conversation`. */
  REPLIED: "crm.contact_replied",
  /** The contact asked not to be contacted (`do_not_contact`). */
  OPTED_OUT: "crm.contact_opted_out",
} as const

export const CRM_ENGAGEMENT_EVENT_NAMES: readonly string[] = Object.values(
  CRM_ENGAGEMENT_EVENTS
)
