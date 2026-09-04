import {
  buildBalancePayUrl,
  planBalanceCollection,
  settleBalance,
  summariseBalancePayments,
  type BalanceSchedule,
} from "../balance-collection"

/**
 * The second half of the money. Figures are the live AUD order that exposed
 * the gap: total A$314.77, deposit A$94.43 paid, balance A$220.34 stranded at
 * `not_due` because nothing in the codebase could raise it.
 */
const PAID_DEPOSIT: BalanceSchedule = {
  id: "01M1NE12YS04WGQK85FG17S73B",
  currency_code: "aud",
  total_due: "314.77",
  deposit_amount: "94.43",
  deposit_status: "paid",
  balance_amount: "220.34",
  balance_status: "not_due",
  order_id: "order_01M1NRXM2TNZ7AXB58E566F2B5",
  rail: "stripe",
}

describe("planBalanceCollection", () => {
  it("collects the stored balance once the deposit is paid", () => {
    const p = planBalanceCollection(PAID_DEPOSIT)

    expect(p.collectable).toBe(true)
    if (!p.collectable) throw new Error("unreachable")
    expect(p.amount).toBe(220.34)
    expect(p.currency_code).toBe("aud")
    expect(p.order_id).toBe("order_01M1NRXM2TNZ7AXB58E566F2B5")
  })

  it("🔑 uses the STORED balance, not total minus deposit recomputed here", () => {
    // The split was written down when the deal was struck. If this recomputed
    // it, the two would drift the first time a rounding rule changed — and the
    // buyer has already been shown a figure.
    const p = planBalanceCollection({
      ...PAID_DEPOSIT,
      balance_amount: "200.00",
      total_due: "314.77",
      deposit_amount: "94.43", // 314.77 - 94.43 = 220.34, deliberately not 200
    })
    if (!p.collectable) throw new Error("expected collectable")
    expect(p.amount).toBe(200)
  })

  it("🔴 refuses while the deposit is unpaid — that is a demand against nothing", () => {
    const p = planBalanceCollection({ ...PAID_DEPOSIT, deposit_status: "pending" })
    expect(p.collectable).toBe(false)
    if (p.collectable) throw new Error("unreachable")
    expect(p.code).toBe("deposit_unpaid")
  })

  it("allows a WAIVED deposit through — waived is settled, not skipped", () => {
    const p = planBalanceCollection({ ...PAID_DEPOSIT, deposit_status: "waived" })
    expect(p.collectable).toBe(true)
  })

  it("refuses an already-paid balance rather than charging twice", () => {
    const p = planBalanceCollection({ ...PAID_DEPOSIT, balance_status: "paid" })
    expect(p.collectable).toBe(false)
    if (p.collectable) throw new Error("unreachable")
    expect(p.code).toBe("already_paid")
  })

  it("refuses a waived balance", () => {
    const p = planBalanceCollection({ ...PAID_DEPOSIT, balance_status: "waived" })
    if (p.collectable) throw new Error("unreachable")
    expect(p.code).toBe("waived")
  })

  it("refuses when no order is attached yet", () => {
    const p = planBalanceCollection({ ...PAID_DEPOSIT, order_id: null })
    if (p.collectable) throw new Error("unreachable")
    expect(p.code).toBe("no_order")
  })

  it("treats a stored zero balance as nothing to collect, not a free one", () => {
    // `Number(null)` is 0 — the guard asks `> 0`, never `!= null`.
    for (const v of ["0", 0, null, ""]) {
      const p = planBalanceCollection({ ...PAID_DEPOSIT, balance_amount: v as any })
      if (p.collectable) throw new Error(`expected refusal for ${String(v)}`)
      expect(p.code).toBe("no_amount")
    }
  })

  it("refuses a negative balance rather than crediting the buyer by accident", () => {
    const p = planBalanceCollection({ ...PAID_DEPOSIT, balance_amount: "-50" })
    if (p.collectable) throw new Error("unreachable")
    expect(p.code).toBe("no_amount")
  })

  it("refuses rather than guessing a currency", () => {
    const p = planBalanceCollection({ ...PAID_DEPOSIT, currency_code: "  " })
    if (p.collectable) throw new Error("unreachable")
    expect(p.code).toBe("no_currency")
  })

  it("survives a missing schedule", () => {
    const p = planBalanceCollection(null)
    if (p.collectable) throw new Error("unreachable")
    expect(p.code).toBe("no_order")
  })

  it("every refusal carries a reason a human can act on", () => {
    const cases: BalanceSchedule[] = [
      { ...PAID_DEPOSIT, deposit_status: "pending" },
      { ...PAID_DEPOSIT, balance_status: "paid" },
      { ...PAID_DEPOSIT, order_id: null },
      { ...PAID_DEPOSIT, balance_amount: "0" },
    ]
    for (const c of cases) {
      const p = planBalanceCollection(c)
      expect(p.collectable).toBe(false)
      expect((p as any).reason.length).toBeGreaterThan(20)
    }
  })
})

describe("buildBalancePayUrl", () => {
  it("keys the link on the SCHEDULE so a sent email keeps working", () => {
    // A payment session can be deleted and remade on retry; the schedule id is
    // the one identifier that survives, so an emailed link stays valid.
    expect(
      buildBalancePayUrl("https://v3.jaalyantra.com", "sched_1")
    ).toBe("https://v3.jaalyantra.com/stripe/pay/balance/sched_1")
  })

  it("does not double the slash on a trailing-slash base url", () => {
    expect(buildBalancePayUrl("https://v3.jaalyantra.com/", "sched_1")).toBe(
      "https://v3.jaalyantra.com/stripe/pay/balance/sched_1"
    )
  })
})

describe("summariseBalancePayments", () => {
  it("counts a captured payment and ignores an authorised hold", () => {
    const s = summariseBalancePayments({
      currency_code: "aud",
      payments: [
        { amount: 220.34, captured_at: "2026-09-05T00:00:00.000Z" },
        { amount: 50, captured_at: null },
      ],
    })
    expect(s.captured).toBe(220.34)
    expect(s.authorized).toBe(50)
  })

  it("subtracts a refund from the captured total", () => {
    const s = summariseBalancePayments({
      currency_code: "aud",
      payments: [
        { amount: 220.34, captured_at: "2026-09-05T00:00:00.000Z", refunded_total: 20.34 },
      ],
    })
    expect(s.captured).toBe(200)
  })

  it("ignores a canceled payment entirely", () => {
    const s = summariseBalancePayments({
      currency_code: "aud",
      payments: [
        { amount: 220.34, captured_at: "2026-09-05T00:00:00.000Z", canceled_at: "2026-09-06" },
      ],
    })
    expect(s.captured).toBe(0)
  })

  it("survives a collection with no payments", () => {
    expect(summariseBalancePayments(null).captured).toBe(0)
    expect(summariseBalancePayments({ payments: null }).captured).toBe(0)
  })
})

describe("settleBalance", () => {
  const state = (captured: number, authorized = 0) => ({
    captured,
    authorized,
    currency_code: "aud",
  })

  it("settles when the full amount is captured", () => {
    const r = settleBalance(220.34, state(220.34))
    expect(r.settled).toBe(true)
  })

  it("settles on an overpayment rather than leaving it open", () => {
    expect(settleBalance(220.34, state(230)).settled).toBe(true)
  })

  it("🔴 does NOT settle on an authorisation — a hold is not money received", () => {
    const r = settleBalance(220.34, state(0, 220.34))
    expect(r.settled).toBe(false)
    expect(r.reason).toMatch(/hold, not money received/i)
  })

  it("🔴 leaves a PARTIAL capture due — 'mostly paid' is not paid", () => {
    const r = settleBalance(220.34, state(100))
    expect(r.settled).toBe(false)
    // Closing here would destroy the only signal that the rest is still owed.
    expect(r.reason).toMatch(/Only 100 of 220.34/)
  })

  it("does not settle a one-cent shortfall", () => {
    expect(settleBalance(220.34, state(220.33)).settled).toBe(false)
  })

  it("settles an exact cent match, without float drift", () => {
    expect(settleBalance(0.1 + 0.2, state(0.3)).settled).toBe(true)
  })

  it("refuses to settle when nothing is expected", () => {
    for (const v of [0, null, undefined, "", "-5"]) {
      expect(settleBalance(v as any, state(100)).settled).toBe(false)
    }
  })

  it("reports nothing captured plainly", () => {
    const r = settleBalance(220.34, state(0))
    expect(r.settled).toBe(false)
    expect(r.reason).toMatch(/Nothing has been captured/i)
  })
})
