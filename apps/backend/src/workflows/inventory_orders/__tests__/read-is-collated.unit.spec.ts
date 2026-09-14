import { readIsCollated } from "../dual-write-unified-order"

/**
 * #2029 item 4 — which screen the partner gets.
 *
 * `collated_design_order` decides whether a work-order renders as "one order,
 * many designs" or as the single-design view. Getting it wrong does not error:
 * it shows a partner holding four designs a screen built for one, and loses the
 * other three.
 */
describe("readIsCollated (#2029 item 4)", () => {
  it("trusts the typed kind when it says collated", () => {
    expect(
      readIsCollated({ unified_order_kind: { kind: "collated" }, metadata: {} })
    ).toBe(true)
  })

  /**
   * The typed row OVERRULES a stale blob — that is the point of typing it.
   */
  it("an explicit per_run beats a stale blob saying collated", () => {
    expect(
      readIsCollated({
        unified_order_kind: { kind: "per_run" },
        metadata: { collated_design_order: true },
      })
    ).toBe(false)
  })

  /**
   * 🔴 The inversion this helper exists to prevent. Every order written before
   * the sidecar existed has NO kind row, and resolving that to `per_run` would
   * render the single-design screen for all of them.
   */
  it("falls back to the blob when there is no kind row at all", () => {
    expect(
      readIsCollated({ metadata: { collated_design_order: true } })
    ).toBe(true)
    expect(
      readIsCollated({ unified_order_kind: null, metadata: { collated_design_order: true } })
    ).toBe(true)
  })

  it("an unrecognised kind value is treated as no answer, not as per_run", () => {
    expect(
      readIsCollated({
        unified_order_kind: { kind: "COLLATED" },
        metadata: { collated_design_order: true },
      })
    ).toBe(true)
  })

  it("is false when neither source says anything", () => {
    expect(readIsCollated({ metadata: {} })).toBe(false)
    expect(readIsCollated(null)).toBe(false)
    expect(readIsCollated(undefined)).toBe(false)
  })

  it("does not treat a truthy non-true blob value as collated", () => {
    expect(readIsCollated({ metadata: { collated_design_order: "yes" } })).toBe(
      false
    )
  })
})
