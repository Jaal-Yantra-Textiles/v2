import { config } from "../visual-flow-event-trigger"
import { PARTNER_QUOTE_EVENT_NAMES } from "../../modules/partner-quote/events"

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
 */
describe("quote events reach the visual-flow trigger", () => {
  const subscribed = new Set(
    (Array.isArray(config.event) ? config.event : [config.event]) as string[]
  )

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
