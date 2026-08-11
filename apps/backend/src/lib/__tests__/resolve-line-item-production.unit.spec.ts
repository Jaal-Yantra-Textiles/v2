import { isOwnedProvenanceRun } from "../resolve-line-item-production"

/**
 * Guards the classifier that decides which runs the fulfillment / cancellation
 * reconciler is allowed to adjust or soft-delete. Getting this wrong in either
 * direction is expensive: too narrow leaves phantom completed runs behind after
 * a cancellation, too broad lets the reconciler delete real shop-floor work.
 */
describe("isOwnedProvenanceRun", () => {
  const MARKER = "order.fulfillment_created"

  it("matches a product-only provenance run", () => {
    expect(
      isOwnedProvenanceRun({ design_id: null, metadata: { source: MARKER } } as any)
    ).toBe(true)
  })

  it("matches a DESIGN-BACKED provenance run", () => {
    // The regression: reconcile-provenance-runs mints these whenever the
    // fulfilled line resolves to a design, stamping design_backed alongside the
    // marker. The old `design_id == null` requirement excluded them, so they
    // were never quantity-adjusted and never voided on cancellation.
    // Real shape from prod: prod_run_01KZJJX9ZT… on design 01KWWJ0S3Z….
    expect(
      isOwnedProvenanceRun({
        design_id: "01KWWJ0S3ZWWNK6YTDSC2AFARQ",
        metadata: { source: MARKER, design_backed: true, is_custom_design: true },
      } as any)
    ).toBe(true)
  })

  it("does NOT match a real design work-order", () => {
    expect(
      isOwnedProvenanceRun({
        design_id: "01KWWJ0S3ZWWNK6YTDSC2AFARQ",
        metadata: { source: "designs-produce-no-customer" },
      } as any)
    ).toBe(false)
  })

  it("does NOT match a run created at order.placed", () => {
    // These go through real production; fulfillment COMPLETES them, but the
    // reconciler must never delete or requantify them.
    expect(
      isOwnedProvenanceRun({
        design_id: null,
        metadata: { source: "order.placed" },
      } as any)
    ).toBe(false)
  })

  it("does NOT match runs with absent or empty metadata", () => {
    expect(isOwnedProvenanceRun({ design_id: null, metadata: null } as any)).toBe(false)
    expect(isOwnedProvenanceRun({ design_id: null, metadata: {} } as any)).toBe(false)
    expect(isOwnedProvenanceRun({ design_id: "d1" } as any)).toBe(false)
  })

  it("is null/undefined safe", () => {
    expect(isOwnedProvenanceRun(null)).toBe(false)
    expect(isOwnedProvenanceRun(undefined)).toBe(false)
  })
})
