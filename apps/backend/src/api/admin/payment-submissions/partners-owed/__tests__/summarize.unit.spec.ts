import {
  comparePartnersOwed,
  partnerNeedsAttention,
  summarizePartnerOwed,
} from "../summarize"

const PARTNER = { id: "partner_1", name: "Raja Shawls", handle: "raja", status: "active" }

const run = (over: Record<string, any> = {}) => ({
  run_id: "run_1",
  billing_status: "clear",
  payable_quantity: 4,
  billable_remaining: null,
  unit_amount: 1100,
  unit_is_derived: false,
  amount: 4400,
  completed_at: "2026-10-20T00:00:00.000Z",
  ...over,
})

const EMPTY_LEDGER = { entries: [], totals: { outstanding: 0, recorded_against_open: 0, currency: null } }

const summarize = (over: Partial<Parameters<typeof summarizePartnerOwed>[0]> = {}) =>
  summarizePartnerOwed({
    partner: PARTNER,
    runs: { payable_runs: [], order_runs: [] },
    inventoryOrders: [],
    ledger: EMPTY_LEDGER,
    ...over,
  })

describe("summarizePartnerOwed — who to pay (#2480)", () => {
  it("a clear priced run is owed at the create screen's untouched figure", () => {
    const row = summarize({ runs: { payable_runs: [run()], order_runs: [] } })
    expect(row.unbilled_work).toBe(4400)
    expect(row.unbilled_work_count).toBe(1)
    expect(row.total_owed).toBe(4400)
    expect(row.oldest_unpaid_at).toBe("2026-10-20T00:00:00.000Z")
  })

  it("an agreed TOTAL bills verbatim, not rate × produced (#1679)", () => {
    // ₹10,000 agreed for 9, 7 made: the derived rate × 7 would be ₹7,777.78.
    const row = summarize({
      runs: {
        payable_runs: [
          run({ payable_quantity: 7, unit_amount: 1111.11, unit_is_derived: true, amount: 10000 }),
        ],
        order_runs: [],
      },
    })
    expect(row.unbilled_work).toBe(10000)
  })

  it("a partly-billed per-unit run is owed only its remainder", () => {
    const row = summarize({
      runs: {
        payable_runs: [run({ billing_status: "partly_billed", payable_quantity: 10, billable_remaining: 9, unit_amount: 100, amount: 1000 })],
        order_runs: [],
      },
    })
    expect(row.unbilled_work).toBe(900)
  })

  it("a partly-billed run whose made units are all billed owes nothing and needs nothing", () => {
    // 9 ordered, 4 made, 4 billed: the ordered ceiling says 5 left, none made.
    const row = summarize({
      runs: {
        payable_runs: [run({ billing_status: "partly_billed", billable_remaining: 5, billed: { claimed_quantity: 4 } })],
        order_runs: [],
      },
    })
    expect(row.total_owed).toBe(0)
    expect(row.needs_price_count).toBe(0)
    expect(partnerNeedsAttention(row)).toBe(false)
  })

  it("a partly-billed TOTAL run is never re-billed — it needs a price", () => {
    const row = summarize({
      runs: {
        payable_runs: [run({ billing_status: "partly_billed", billable_remaining: 2, unit_is_derived: true, amount: 10000 })],
        order_runs: [],
      },
    })
    expect(row.unbilled_work).toBe(0)
    expect(row.needs_price_count).toBe(1)
    expect(row.total_owed).toBe(0)
  })

  it("an `unknown` run is NOT owed — it is reported to check first", () => {
    const row = summarize({
      runs: { payable_runs: [run({ billing_status: "unknown" })], order_runs: [] },
    })
    expect(row.total_owed).toBe(0)
    expect(row.check_first_count).toBe(1)
    expect(row.check_first_amount).toBe(4400)
    expect(partnerNeedsAttention(row)).toBe(true)
  })

  it("billed runs and unpriced runs add nothing to the total", () => {
    const row = summarize({
      runs: {
        payable_runs: [
          run({ billing_status: "billed" }),
          run({ run_id: "run_2", unit_amount: 0, amount: 0 }),
        ],
        order_runs: [{ billing_status: "clear" }, { billing_status: "billed" }],
      },
    })
    expect(row.total_owed).toBe(0)
    // the unpriced run + the unbilled order group
    expect(row.needs_price_count).toBe(2)
  })

  it("goods: only payable orders count; a prepaid-looking one is flagged, not netted", () => {
    const row = summarize({
      inventoryOrders: [
        { payable: true, amount: 5800, currency_code: "inr", recorded_covers_amount: true, order_date: "2026-03-01T00:00:00.000Z" },
        { payable: false, amount: 0 },
      ],
    })
    expect(row.unbilled_goods).toBe(5800)
    expect(row.unbilled_goods_count).toBe(1)
    expect(row.goods_possibly_prepaid_count).toBe(1)
    expect(row.total_owed).toBe(5800)
    expect(row.mixed_currency).toBe(false)
  })

  it("billed-unpaid is the ledger's outstanding, dated by the oldest unpaid payout", () => {
    const row = summarize({
      runs: { payable_runs: [run()], order_runs: [] },
      ledger: {
        totals: { outstanding: 3000, recorded_against_open: 500, currency: "inr" },
        entries: [
          { kind: "payout", status: "Approved", amount: 3000, settled_amount: 0, submitted_at: "2026-09-01T00:00:00.000Z" },
          { kind: "payout", status: "Paid", amount: 9000, submitted_at: "2026-01-01T00:00:00.000Z" },
          { kind: "payout", status: "Rejected", amount: 100, submitted_at: "2025-01-01T00:00:00.000Z" },
          { kind: "payment", amount: 500, occurred_at: "2024-01-01T00:00:00.000Z" },
        ],
      },
    })
    expect(row.billed_unpaid).toBe(3000)
    expect(row.unpaid_payout_count).toBe(1)
    expect(row.recorded_against_open).toBe(500)
    expect(row.total_owed).toBe(7400)
    expect(row.oldest_unpaid_at).toBe("2026-09-01T00:00:00.000Z")
  })

  it("a partner owed nothing does not need attention", () => {
    const row = summarize()
    expect(row.total_owed).toBe(0)
    expect(row.oldest_unpaid_at).toBeNull()
    expect(partnerNeedsAttention(row)).toBe(false)
  })

  it("sorts most owed first, then longest waiting", () => {
    const a = { ...summarize(), partner_id: "a", total_owed: 100, oldest_unpaid_at: "2026-10-01" }
    const b = { ...summarize(), partner_id: "b", total_owed: 4400, oldest_unpaid_at: "2026-10-20" }
    const c = { ...summarize(), partner_id: "c", total_owed: 100, oldest_unpaid_at: "2026-01-01" }
    expect([a, b, c].sort(comparePartnersOwed).map((r) => r.partner_id)).toEqual(["b", "c", "a"])
  })
})
