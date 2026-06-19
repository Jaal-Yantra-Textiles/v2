import {
  backfillPartnerOrderFeesJob,
  getMaintenanceJob,
  MAINTENANCE_JOBS,
  MAX_PARTNER_FEE_BACKFILL_SCAN,
  shouldBackfillOrderFee,
  summarizePartnerFeeBackfill,
} from "../registry"

/**
 * #336 Slice 5 — pure logic for the `backfill-partner-order-fees` maintenance
 * job. The container-bound run() (query.graph order-link enumerate + per-order
 * findFeeForOrder + createPartnerFees) is exercised by the API contract
 * integration test; here we lock down the eligibility decision and the summary
 * string without booting the DB.
 */
describe("backfill-partner-order-fees — shouldBackfillOrderFee", () => {
  it("accrues an eligible order with no existing fee", () => {
    expect(shouldBackfillOrderFee(null, "completed")).toBe(true)
    expect(shouldBackfillOrderFee(undefined, "pending")).toBe(true)
  })

  it("skips an order that already has a fee (idempotent)", () => {
    expect(shouldBackfillOrderFee({ id: "fee_1" }, "completed")).toBe(false)
  })

  it("skips a canceled order (would have netted to zero)", () => {
    expect(shouldBackfillOrderFee(null, "canceled")).toBe(false)
    expect(shouldBackfillOrderFee(null, "Canceled")).toBe(false)
    expect(shouldBackfillOrderFee(null, "CANCELED")).toBe(false)
  })

  it("an existing fee wins over status (already handled, even if canceled)", () => {
    expect(shouldBackfillOrderFee({ id: "fee_1" }, "canceled")).toBe(false)
  })

  it("treats null/undefined status as eligible (no fee present)", () => {
    expect(shouldBackfillOrderFee(null, null)).toBe(true)
    expect(shouldBackfillOrderFee(null, undefined)).toBe(true)
  })
})

describe("backfill-partner-order-fees — summarizePartnerFeeBackfill", () => {
  it("reports no-change when nothing accrued", () => {
    expect(summarizePartnerFeeBackfill(true, 3, 12, 0, 0)).toMatch(
      /No changes — scanned 12 partner order\(s\) across 3 partner\(s\)/
    )
  })

  it("uses 'Would accrue' for dry-run and 'Accrued' for apply", () => {
    expect(summarizePartnerFeeBackfill(true, 2, 5, 4, 0)).toMatch(/^Would accrue 4 commission fee\(s\)/)
    expect(summarizePartnerFeeBackfill(false, 2, 5, 4, 0)).toMatch(/^Accrued 4 commission fee\(s\)/)
  })

  it("appends an error count when partners failed", () => {
    expect(summarizePartnerFeeBackfill(false, 2, 5, 4, 1)).toMatch(/; 1 error\(s\)$/)
    expect(summarizePartnerFeeBackfill(true, 2, 5, 0, 2)).toMatch(/; 2 error\(s\)$/)
  })
})

describe("backfill-partner-order-fees — registry wiring", () => {
  it("is registered and resolvable by id", () => {
    expect(getMaintenanceJob("backfill-partner-order-fees")).toBe(
      backfillPartnerOrderFeesJob
    )
    expect(MAINTENANCE_JOBS).toContain(backfillPartnerOrderFeesJob)
  })

  it("exposes optional partner_id + bounded limit params", () => {
    const names = backfillPartnerOrderFeesJob.params.map((p) => p.name)
    expect(names).toEqual(["partner_id", "limit"])
    expect(backfillPartnerOrderFeesJob.params.every((p) => p.required !== true)).toBe(true)
    expect(MAX_PARTNER_FEE_BACKFILL_SCAN).toBe(5000)
  })
})
