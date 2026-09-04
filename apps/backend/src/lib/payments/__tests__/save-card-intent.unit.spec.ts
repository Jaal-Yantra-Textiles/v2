import {
  saveCardSessionData,
  shouldSaveCardForLater,
} from "../save-card-intent"

/**
 * The card is kept only when a balance follows (#1792 tail).
 *
 * These are cheap because the decision was deliberately made pure — the
 * expensive half (does Stripe actually reuse the card?) was proven against
 * Stripe test mode: with a customer the balance charged off-session and
 * returned `succeeded`; without one it failed at
 * "you must attach it to a Customer first".
 */
describe("shouldSaveCardForLater", () => {
  it("keeps the card on a deposit — a balance is still owed", () => {
    expect(shouldSaveCardForLater({ basis: "deposit" })).toBe(true)
  })

  it("does NOT keep the card on a full payment — nothing is left to charge", () => {
    expect(shouldSaveCardForLater({ basis: "full" })).toBe(false)
  })

  it("does NOT keep the card when the plan refuses", () => {
    expect(shouldSaveCardForLater({ basis: "refuse" })).toBe(false)
  })
})

describe("saveCardSessionData", () => {
  it("asks Stripe for off-session reuse on a deposit", () => {
    expect(saveCardSessionData({ basis: "deposit" })).toEqual({
      setup_future_usage: "off_session",
    })
  })

  /**
   * 🔴 The key must be ABSENT, not present-and-undefined.
   *
   * `stripe-base.js` forwards `extra?.setup_future_usage` straight into the
   * PaymentIntent request, so an explicit `undefined` is still a key on the
   * object. Asserting `toEqual({})` alone would pass for
   * `{ setup_future_usage: undefined }`, so the key list is checked directly.
   */
  it("sends no key at all when the card should not be kept", () => {
    const data = saveCardSessionData({ basis: "full" })
    expect(Object.keys(data)).toEqual([])
    expect("setup_future_usage" in data).toBe(false)
  })
})
