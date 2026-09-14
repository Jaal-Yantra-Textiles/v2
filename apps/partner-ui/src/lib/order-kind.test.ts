import { describe, it, expect } from "vitest"
import { isCollatedOrder } from "./order-kind"

/**
 * #2029 item 4 — which screen the partner gets.
 *
 * The backend has the same three rules in `readIsCollated`; both are tested,
 * because a disagreement between them would show the list and the detail page
 * two different things about one order.
 */
describe("isCollatedOrder", () => {
  it("trusts the typed kind when it says collated", () => {
    expect(
      isCollatedOrder({ unified_order_kind: { kind: "collated" }, metadata: {} })
    ).toBe(true)
  })

  it("an explicit per_run beats a stale blob saying collated", () => {
    expect(
      isCollatedOrder({
        unified_order_kind: { kind: "per_run" },
        metadata: { collated_design_order: true },
      })
    ).toBe(false)
  })

  /**
   * 🔴 Every order written before the sidecar existed has no kind row.
   * Resolving that to per_run renders the single-design screen for a collated
   * job and loses every design in it but the first.
   */
  it("falls back to the blob when there is no kind row", () => {
    expect(isCollatedOrder({ metadata: { collated_design_order: true } })).toBe(
      true
    )
  })

  it("is false when neither source says anything", () => {
    expect(isCollatedOrder({ metadata: {} })).toBe(false)
    expect(isCollatedOrder(undefined)).toBe(false)
  })
})
