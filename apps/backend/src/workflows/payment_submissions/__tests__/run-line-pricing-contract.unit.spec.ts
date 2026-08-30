import { resolvePaymentLineAmount } from "../create-payment-submission"
import {
  runPayableOffer,
  resolveRunLinePrice,
} from "../../production-runs/lib/run-payable"

/**
 * #1616 — the offer screen and the create path were two different pricers over
 * one run.
 *
 * `payable-runs` offered ₹810 for `prod_run_01KWPVZ4R2PWK6DW1X8X5DKNZE`
 * ("Princess Highway", Sharlho). Creating the submission for that exact run,
 * naming it in `production_run_ids`, wrote ₹1,056.40 — the DESIGN's
 * `estimated_cost`. +30%, and invisible: `create` returns `items: []`, so the
 * amount could not be seen until the submission was fetched again.
 *
 * 🔑 The contract these tests hold is the one the issue asked for: what the
 * screen OFFERS is what `create` WRITES, for the same run.
 */

/** The real prod row that exposed the defect. */
const PRINCESS_HIGHWAY = {
  id: "prod_run_01KWPVZ4R2PWK6DW1X8X5DKNZE",
  design_id: "design_1",
  partner_id: "01K4PJMNMNRGMK0ZXMKBBDZDGD",
  status: "completed",
  quantity: 1,
  produced_quantity: 1,
  partner_cost_estimate: 810,
  cost_type: "total" as const,
}

/** What the design says, and what `create` used to bill instead. */
const DESIGN_ESTIMATED_COST = 1056.4

describe("payable-runs offer === what create writes", () => {
  it("prices the Princess Highway run at the OFFER, not the design estimate", () => {
    const offer = runPayableOffer(PRINCESS_HIGHWAY)
    const written = resolvePaymentLineAmount({
      runs: [PRINCESS_HIGHWAY],
      unit_cost: DESIGN_ESTIMATED_COST,
    })

    expect(offer.amount).toBe(810)
    expect(written.amount).toBe(offer.amount)
    // The exact overbill the issue reports, now impossible.
    expect(written.amount).not.toBe(1056.4)
  })

  it("agrees for a per_unit run produced fewer times than ordered", () => {
    const run = {
      ...PRINCESS_HIGHWAY,
      quantity: 9,
      produced_quantity: 7,
      partner_cost_estimate: 1200,
      cost_type: "per_unit" as const,
    }

    const offer = runPayableOffer(run)
    const written = resolvePaymentLineAmount({ runs: [run], unit_cost: 850 })

    // Paid for what they MADE — 7 x 1200, not 9.
    expect(offer.amount).toBe(8400)
    expect(offer.quantity_basis).toBe("produced")
    expect(written.amount).toBe(offer.amount)
    expect(written.quantity).toBe(7)
    expect(written.unit_amount).toBe(1200)
  })

  it("falls back to ordered when output was never recorded, on both sides", () => {
    const run = {
      ...PRINCESS_HIGHWAY,
      quantity: 4,
      produced_quantity: null,
      partner_cost_estimate: 500,
      cost_type: "per_unit" as const,
    }

    const offer = runPayableOffer(run)
    const written = resolvePaymentLineAmount({ runs: [run], unit_cost: 850 })

    expect(offer.quantity_basis).toBe("ordered")
    expect(written.amount).toBe(offer.amount)
    expect(written.amount).toBe(2000)
  })

  it("sums a line claiming several runs to the sum of their offers", () => {
    const a = { ...PRINCESS_HIGHWAY, id: "run_a" }
    const b = {
      ...PRINCESS_HIGHWAY,
      id: "run_b",
      partner_cost_estimate: 810,
      quantity: 1,
      produced_quantity: 1,
    }

    const offered = runPayableOffer(a).amount + runPayableOffer(b).amount
    const written = resolvePaymentLineAmount({
      runs: [a, b],
      unit_cost: DESIGN_ESTIMATED_COST,
    })

    expect(written.amount).toBe(offered)
    expect(written.quantity).toBe(2)
    /**
     * ⚠️ Was `810`. Both runs are `cost_type: "total"`, so 810 is DERIVED —
     * ₹810 agreed for one piece happens to divide to ₹810 — and #1596's rule is
     * that a derived rate is never written down as an agreed one. Null here is
     * the change, and it is the point: `unit_amount` states a price somebody
     * agreed to, or nothing.
     */
    expect(written.unit_amount).toBeNull()
  })
})

describe("resolvePaymentLineAmount precedence", () => {
  it("a typed TOTAL still wins over the runs", () => {
    // The auto-draft passes runPayableAmount's already-multiplied figure here.
    // Re-multiplying it is #456.
    const written = resolvePaymentLineAmount({
      runs: [PRINCESS_HIGHWAY],
      unit_cost: DESIGN_ESTIMATED_COST,
      override: 999,
    })

    expect(written.amount).toBe(999)
    expect(written.unit_amount).toBeNull()
  })

  it("a typed RATE still wins over the runs", () => {
    const written = resolvePaymentLineAmount({
      runs: [PRINCESS_HIGHWAY],
      unit_cost: DESIGN_ESTIMATED_COST,
      unit_override: 100,
      quantity: 3,
    })

    expect(written.amount).toBe(300)
    expect(written.unit_amount).toBe(100)
  })

  it("bills the RUNS' rate for a caller-supplied quantity", () => {
    // Correcting how many, not what each one costs.
    const run = {
      ...PRINCESS_HIGHWAY,
      quantity: 9,
      produced_quantity: 9,
      partner_cost_estimate: 1200,
      cost_type: "per_unit" as const,
    }

    const written = resolvePaymentLineAmount({
      runs: [run],
      unit_cost: DESIGN_ESTIMATED_COST,
      quantity: 4,
    })

    expect(written.amount).toBe(4800)
    expect(written.unit_amount).toBe(1200)
  })

  it("falls back to the DESIGN when a claimed run carries no agreed rate", () => {
    // Not a refusal: billing a run whose price was agreed off-system is the
    // documented flow, and payable-runs shows the design's figure the same way.
    const run = { ...PRINCESS_HIGHWAY, partner_cost_estimate: null }

    const written = resolvePaymentLineAmount({
      runs: [run as any],
      unit_cost: DESIGN_ESTIMATED_COST,
    })

    expect(written.amount).toBe(DESIGN_ESTIMATED_COST)
    expect(written.unit_amount).toBe(DESIGN_ESTIMATED_COST)
  })

  it("is byte-for-byte today's behaviour for a line with NO runs", () => {
    const written = resolvePaymentLineAmount({
      runs: [],
      unit_cost: 850,
      quantity: 9,
    })

    expect(written).toEqual({ amount: 7650, quantity: 9, unit_amount: 850 })
  })

  it("records no rate when the claimed runs carry DIFFERENT rates", () => {
    // There is no single rate behind such a line; dividing the total back out
    // would invent one.
    const cheap = { ...PRINCESS_HIGHWAY, id: "a", partner_cost_estimate: 100 }
    const dear = { ...PRINCESS_HIGHWAY, id: "b", partner_cost_estimate: 900 }

    const written = resolvePaymentLineAmount({
      runs: [cheap, dear],
      unit_cost: DESIGN_ESTIMATED_COST,
    })

    expect(written.amount).toBe(1000)
    expect(written.unit_amount).toBeNull()
  })

  it("never zeroes a mixed-rate line just because a quantity was supplied", () => {
    // 🔴 There is no rate to multiply by, but the summed total IS agreed.
    // A 0 in front of a partner is the worst possible answer here.
    const cheap = { ...PRINCESS_HIGHWAY, id: "a", partner_cost_estimate: 100 }
    const dear = { ...PRINCESS_HIGHWAY, id: "b", partner_cost_estimate: 900 }

    const written = resolvePaymentLineAmount({
      runs: [cheap, dear],
      unit_cost: DESIGN_ESTIMATED_COST,
      quantity: 5,
    })

    expect(written.amount).toBe(1000)
    expect(written.quantity).toBe(5)
    expect(written.unit_amount).toBeNull()
  })
})

describe("resolveRunLinePrice", () => {
  it("returns null when NO claimed run carries a rate", () => {
    const written = resolveRunLinePrice([
      { ...PRINCESS_HIGHWAY, partner_cost_estimate: null } as any,
    ])

    expect(written).toBeNull()
  })

  it("ignores rate-less runs among priced ones rather than billing them at 0", () => {
    const priced = PRINCESS_HIGHWAY
    const unpriced = {
      ...PRINCESS_HIGHWAY,
      id: "b",
      partner_cost_estimate: null,
    }

    const written = resolveRunLinePrice([priced, unpriced as any])

    expect(written?.amount).toBe(810)
    expect(written?.quantity).toBe(1)
  })
})

/**
 * #1596 — the ADMIN SCREEN's fold must reach the same figure as the server's.
 *
 * The screen does not just display an amount; it chooses which request field
 * carries it, and `create` prices in a fixed order — a typed line total wins
 * outright, then a typed RATE, and only then the runs. So a screen that sends a
 * DERIVED rate as `unit_amounts` outranks `resolveRunLinePrice` and makes the
 * server multiply a figure that was never per-piece.
 *
 * 🔴 That is what the admin create screen did for as long as it has existed.
 * `payable-runs` has always sent `unit_is_derived`; the client type never
 * declared it, so no screen could read it and none did.
 */
describe("the admin screen's fold agrees with the server's pricer", () => {
  /** ₹10,000 agreed for the job, 9 ordered, 7 made. */
  const TOTAL_PRICED_RUN = {
    id: "prod_run_total",
    design_id: "design_total",
    partner_id: "partner_1",
    status: "completed",
    quantity: 9,
    produced_quantity: 7,
    partner_cost_estimate: 10000,
    cost_type: "total" as const,
  }

  it("bills the agreed total, whichever end computes it", () => {
    const offer = runPayableOffer(TOTAL_PRICED_RUN)
    expect(offer.unit_is_derived).toBe(true)
    expect(offer.amount).toBe(10000)

    // What the screen now sends for such a line: the offer's amount as a line
    // TOTAL, never the derived rate.
    const asScreenSendsIt = resolvePaymentLineAmount({
      runs: [TOTAL_PRICED_RUN],
      unit_cost: 0,
      quantity: offer.quantity,
      override: offer.amount,
      unit_override: null,
    })
    expect(asScreenSendsIt.amount).toBe(10000)

    // And letting the server price it from the runs reaches the same figure,
    // so the two ends cannot drift.
    const asServerPricesIt = resolvePaymentLineAmount({
      runs: [TOTAL_PRICED_RUN],
      unit_cost: 0,
      quantity: offer.quantity,
      override: null,
      unit_override: null,
    })
    expect(asServerPricesIt.amount).toBe(10000)
  })

  it("would have UNDERPAID had the derived rate been sent as a rate", () => {
    // The defect this guards, stated as arithmetic. 7 x (10000/7) loses a
    // paisa; the same rate against the ordered 9 invents ₹2,857 nobody agreed.
    const offer = runPayableOffer(TOTAL_PRICED_RUN)

    const sentAsRate = resolvePaymentLineAmount({
      runs: [TOTAL_PRICED_RUN],
      unit_cost: 0,
      quantity: offer.quantity,
      override: null,
      unit_override: offer.unit_amount,
    })

    expect(sentAsRate.amount).not.toBe(10000)
    expect(sentAsRate.amount).toBeLessThan(10000)
  })
})
