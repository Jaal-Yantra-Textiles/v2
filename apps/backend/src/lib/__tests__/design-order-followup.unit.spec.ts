import {
  DAY_MS,
  followupAnchor,
  formatCloseOn,
  nextFollowupState,
  planDesignOrderFollowup,
} from "../design-order-followup"

const T0 = new Date("2026-12-01T00:00:00.000Z").getTime()
const iso = (t: number) => new Date(t).toISOString()
const ok = { has_email: true, money_received: false }

const cart = (md: Record<string, any> = {}, created = T0) => ({
  id: "cart_1",
  created_at: iso(created),
  completed_at: null,
  metadata: { source: "design-order", ...md },
})

describe("followupAnchor", () => {
  it("never starts before the launch floor", () => {
    expect(followupAnchor(cart({}, new Date("2026-11-17T04:31:00Z").getTime()))).toBe(
      "2026-11-25T00:00:00.000Z"
    )
  })
  it("moves to the latest resend (a new payment link)", () => {
    const c = cart({ payu_link: { created_at: iso(T0 + 2 * DAY_MS) } })
    expect(followupAnchor(c)).toBe(iso(T0 + 2 * DAY_MS))
  })
})

describe("planDesignOrderFollowup", () => {
  it.each([
    [{ source: "storefront" }, "not a design order"],
    [{ cancelled_at: "2026-12-01T00:00:00Z" }, "already cancelled"],
    [{ converted_order_id: "order_1" }, "converted to an order"],
    [{ payu_completed_txnid: "tx" }, "paid"],
  ])("skips %j", (md, reason) => {
    expect(planDesignOrderFollowup(cart(md), { now: T0 + 8 * DAY_MS, ...ok })).toEqual({
      action: "skip",
      reason,
    })
  })

  it("skips a cart with money received or no email, even when overdue", () => {
    expect(planDesignOrderFollowup(cart(), { now: T0 + 9 * DAY_MS, has_email: true, money_received: true }).action).toBe("skip")
    expect(planDesignOrderFollowup(cart(), { now: T0 + 9 * DAY_MS, has_email: false, money_received: false }).action).toBe("skip")
  })

  it("waits for the first two days, reminds on day 3", () => {
    expect(planDesignOrderFollowup(cart(), { now: T0 + 2.9 * DAY_MS, ...ok }).action).toBe("wait")
    const p = planDesignOrderFollowup(cart(), { now: T0 + 3 * DAY_MS, ...ok })
    expect(p).toMatchObject({ action: "remind", day: 3, close_on: "8 December 2026" })
  })

  it("does not remind twice, sends the last call on day 6, then closes on day 7", () => {
    const anchor = iso(T0)
    const reminded = cart({ design_order_followup: { anchor, reminder_sent_at: iso(T0 + 3 * DAY_MS) } })
    expect(planDesignOrderFollowup(reminded, { now: T0 + 4 * DAY_MS, ...ok }).action).toBe("wait")
    expect(planDesignOrderFollowup(reminded, { now: T0 + 6 * DAY_MS, ...ok }).action).toBe("last_call")

    const called = cart({
      design_order_followup: { anchor, reminder_sent_at: iso(T0 + 3 * DAY_MS), last_call_sent_at: iso(T0 + 6 * DAY_MS) },
    })
    expect(planDesignOrderFollowup(called, { now: T0 + 6.5 * DAY_MS, ...ok }).action).toBe("wait")
    expect(planDesignOrderFollowup(called, { now: T0 + 7 * DAY_MS, ...ok }).action).toBe("close")
  })

  it("never closes without a last call first", () => {
    expect(planDesignOrderFollowup(cart(), { now: T0 + 10 * DAY_MS, ...ok }).action).toBe("last_call")
    const justCalled = cart({ design_order_followup: { anchor: iso(T0), last_call_sent_at: iso(T0 + 10 * DAY_MS) } })
    expect(planDesignOrderFollowup(justCalled, { now: T0 + 10.5 * DAY_MS, ...ok }).action).toBe("wait")
  })

  it("a resend gives a fresh 7 days and fresh reminders", () => {
    const resent = cart({
      payu_link: { created_at: iso(T0 + 5 * DAY_MS) },
      design_order_followup: { anchor: iso(T0), reminder_sent_at: iso(T0 + 3 * DAY_MS), last_call_sent_at: iso(T0 + 6 * DAY_MS) },
    })
    expect(planDesignOrderFollowup(resent, { now: T0 + 7 * DAY_MS, ...ok }).action).toBe("wait")
    expect(planDesignOrderFollowup(resent, { now: T0 + 8 * DAY_MS, ...ok }).action).toBe("remind")
  })

  it("an order already past day 6 at launch gets only the last call, not both", () => {
    expect(planDesignOrderFollowup(cart(), { now: T0 + 6 * DAY_MS, ...ok }).action).toBe("last_call")
  })
})

describe("nextFollowupState", () => {
  it("keeps earlier stamps for the same anchor and resets on a new one", () => {
    const a = iso(T0)
    const s1 = nextFollowupState(undefined, "remind", a, "r")
    expect(s1).toEqual({ anchor: a, reminder_sent_at: "r" })
    expect(nextFollowupState(s1, "last_call", a, "l")).toEqual({ anchor: a, reminder_sent_at: "r", last_call_sent_at: "l" })
    expect(nextFollowupState(s1, "last_call", iso(T0 + DAY_MS), "l")).toEqual({ anchor: iso(T0 + DAY_MS), last_call_sent_at: "l" })
  })
})

describe("formatCloseOn", () => {
  it("is anchor + 7 days, in UTC", () => {
    expect(formatCloseOn("2026-11-25T00:00:00.000Z")).toBe("2 December 2026")
  })
})
