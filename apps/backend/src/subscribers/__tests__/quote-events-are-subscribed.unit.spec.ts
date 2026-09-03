import { config } from "../visual-flow-event-trigger"
import {
  CRM_ENGAGEMENT_EVENT_NAMES,
  PARTNER_QUOTE_EVENT_NAMES,
} from "../../modules/partner-quote/events"

/**
 * Every event the quote path emits must be one the visual-flow trigger is
 * actually subscribed to.
 *
 * ## The failure this exists to catch
 *
 * `config.event` is an ALLOWLIST. Medusa delivers a subscriber only the events
 * it names, and says nothing about the rest. So an event that is emitted but
 * missing from that array produces the quietest possible failure:
 *
 *   - the emit succeeds, and logs nothing wrong
 *   - an active flow names the event as its trigger and looks correctly wired
 *   - executing that flow BY HAND completes and sends the email
 *   - and in production, nothing happens at all, forever
 *
 * That is not hypothetical. `partner_quote.minted` was emitted, a flow was
 * built and activated against it, a manual run of that flow sent the
 * introduction correctly — and three real mints on prod produced ZERO
 * executions. The subscriber's header even claimed custom events would be
 * matched automatically, which is false.
 *
 * 🔑 A manual flow run proves the FLOW works. It bypasses the subscriber
 * entirely, so it can never prove the flow will be triggered. Only this
 * pairing does.
 *
 * ## #1355 — the same trap, crm.* edition
 *
 * The CRM engagement sweep emitted `crm.follow_up_due`, `crm.contact_stalled`,
 * `crm.contact_replied` and `crm.contact_opted_out` while none of them were in
 * the allowlist, so step 6 of the flow feature — any flow triggering on
 * `crm.*` — could not fire. The guard therefore covers those names too. The
 * sweep's emitter keeps its own local name map and is not coupled to the
 * events module, so `CRM_ENGAGEMENT_EVENT_NAMES` is the guard's copy: a new
 * crm.* event must be added there as well, or it rides the same silent
 * failure this file exists to make loud.
 */
const subscribed = new Set(
  (Array.isArray(config.event) ? config.event : [config.event]) as string[]
)

describe("quote events reach the visual-flow trigger", () => {
  it.each(PARTNER_QUOTE_EVENT_NAMES)(
    "🔴 %s is in the subscriber's allowlist",
    (eventName) => {
      expect(subscribed.has(eventName)).toBe(true)
    }
  )

  /**
   * Guards the guard: if the events module were ever emptied, the `it.each`
   * above would silently assert nothing and pass.
   */
  it("has quote events to check in the first place", () => {
    expect(PARTNER_QUOTE_EVENT_NAMES.length).toBeGreaterThan(0)
  })
})

describe("crm engagement events reach the visual-flow trigger", () => {
  it.each(CRM_ENGAGEMENT_EVENT_NAMES)(
    "🔴 %s is in the subscriber's allowlist",
    (eventName) => {
      expect(subscribed.has(eventName)).toBe(true)
    }
  )

  /**
   * Guards the guard, same as above: an emptied CRM list would silently
   * assert nothing and pass.
   */
  it("has crm engagement events to check in the first place", () => {
    expect(CRM_ENGAGEMENT_EVENT_NAMES.length).toBeGreaterThan(0)
  })
})
