import {
  decideLinkSweep,
  formatExpiryForBuyer,
  payuLinkTtlHours,
  readTrackedLink,
  toPayuIstDateTime,
} from "../payu-link-expiry"

const NOW = new Date("2026-11-21T13:00:00.000Z")
const link = (over: any = {}) => ({
  invoice_number: "inv1",
  url: "https://v.payu.in/abc",
  expires_at: "2026-11-21T12:00:00.000Z", // an hour ago
  created_at: "2026-11-19T12:00:00.000Z",
  ...over,
})
const base = { completedAt: null, cancelledAt: null, hasEmail: true, now: NOW }

describe("payu link expiry helpers", () => {
  it("formats PayU's expiryDate in IST wall time", () => {
    expect(toPayuIstDateTime(new Date("2026-11-23T13:00:00.000Z"))).toBe("2026-11-23 18:30:00")
    // crosses midnight IST
    expect(toPayuIstDateTime(new Date("2026-11-23T19:00:05.000Z"))).toBe("2026-11-24 00:30:05")
  })

  it("formats the buyer's expiry in IST, 12-hour", () => {
    expect(formatExpiryForBuyer(new Date("2026-11-23T13:00:00.000Z"))).toBe("Mon 23 Nov 2026, 6:30 pm IST")
    expect(formatExpiryForBuyer(new Date("2026-11-23T18:45:00.000Z"))).toBe("Tue 24 Nov 2026, 12:15 am IST")
  })

  it("defaults the TTL to 48h and honours a positive override", () => {
    expect(payuLinkTtlHours({})).toBe(48)
    expect(payuLinkTtlHours({ DESIGN_ORDER_PAYU_LINK_TTL_HOURS: "24" })).toBe(24)
    expect(payuLinkTtlHours({ DESIGN_ORDER_PAYU_LINK_TTL_HOURS: "0" })).toBe(48)
    expect(payuLinkTtlHours({ DESIGN_ORDER_PAYU_LINK_TTL_HOURS: "abc" })).toBe(48)
  })

  it("reads only a well-formed tracked link", () => {
    expect(readTrackedLink({ payu_link: link() })?.invoice_number).toBe("inv1")
    expect(readTrackedLink({})).toBeNull()
    expect(readTrackedLink({ payu_link: { invoice_number: "x", expires_at: "nope" } })).toBeNull()
    expect(readTrackedLink(null)).toBeNull()
  })
})

describe("decideLinkSweep", () => {
  it("closes and emails an expired link on an open cart", () => {
    expect(decideLinkSweep({ ...base, link: link() })).toEqual({
      kind: "close",
      reason: "expired",
      notify: true,
    })
  })

  it("closes without email when there is no buyer email", () => {
    expect(decideLinkSweep({ ...base, hasEmail: false, link: link() })).toEqual({
      kind: "close",
      reason: "expired",
      notify: false,
    })
  })

  it("leaves a live link alone", () => {
    expect(decideLinkSweep({ ...base, link: link({ expires_at: "2026-11-22T00:00:00.000Z" }) }).kind).toBe("skip")
  })

  it("🔴 closes a still-live link on a COMPLETED cart, never emails — a second payment is the risk", () => {
    expect(
      decideLinkSweep({
        ...base,
        completedAt: "2026-11-21T10:00:00Z",
        link: link({ expires_at: "2026-11-22T00:00:00.000Z" }),
      })
    ).toEqual({ kind: "close", reason: "completed", notify: false })
  })

  it("closes on a cancelled design order without an 'expired' email", () => {
    expect(decideLinkSweep({ ...base, cancelledAt: "2026-11-21T10:00:00Z", link: link() })).toEqual({
      kind: "close",
      reason: "cancelled",
      notify: false,
    })
  })

  it("retries only the email when closed-as-expired but never notified", () => {
    expect(
      decideLinkSweep({ ...base, link: link({ closed_at: "x", closed_reason: "expired" }) })
    ).toEqual({ kind: "notify_only" })
    expect(
      decideLinkSweep({
        ...base,
        link: link({ closed_at: "x", closed_reason: "expired", expiry_notified_at: "y" }),
      }).kind
    ).toBe("skip")
    // replaced/paid links are never "expired" mail
    expect(
      decideLinkSweep({ ...base, link: link({ closed_at: "x", closed_reason: "paid" }) }).kind
    ).toBe("skip")
  })
})
