/**
 * Why a dispatch produced runs but no work-order — said out loud.
 *
 * The projection always knew (`skipped` / `error`); `produceDesignsAsWorkOrder`
 * dropped it and returned a bare `work_order_id: null`, which the admin drawer
 * rendered as a green "Sent" toast. These pin the words the operator now sees.
 */
import { describeMissingWorkOrder } from "../produce-designs-as-work-order"

describe("describeMissingWorkOrder", () => {
  it("names the region refusal and what to fix", () => {
    const text = describeMissingWorkOrder({ skipped: "no_region" })
    expect(text).toMatch(/region/i)
    expect(text).toMatch(/default region/i)
  })

  it("carries a thrown error's message through", () => {
    expect(
      describeMissingWorkOrder({ error: "duplicate key value violates unique constraint" })
    ).toContain("duplicate key value violates unique constraint")
  })

  it("reports any other skip reason verbatim", () => {
    expect(describeMissingWorkOrder({ skipped: "no_runs" })).toContain("no_runs")
  })

  it("never returns an empty string, even with nothing to go on", () => {
    expect(describeMissingWorkOrder({}).length).toBeGreaterThan(0)
  })
})
