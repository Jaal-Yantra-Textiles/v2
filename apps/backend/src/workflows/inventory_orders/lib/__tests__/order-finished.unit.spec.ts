import { assessInventoryOrderFinished, isFullyReceived } from "../order-finished"
import { latestWorkflowRollbacks } from "../../../../api/admin/ops/maintenance-jobs/relink-rolled-back-inventory-order-partners-job"

/**
 * #2324 — the send-to-partner rollback keeps the partner link on a FINISHED
 * order. "Finished" is evidence, never a status name alone.
 */
describe("assessInventoryOrderFinished", () => {
  const base = { metadata: null, received_quantity: 0, paid_payout_ids: [] as string[] }

  it("Delivered is finished", () => {
    const v = assessInventoryOrderFinished({ ...base, status: "Delivered" })
    expect(v.finished).toBe(true)
    expect(v.reasons).toEqual(["status is Delivered"])
  })

  it("Shipped with NOTHING received is not finished — the parcel may still be on a truck", () => {
    expect(assessInventoryOrderFinished({ ...base, status: "Shipped" })).toEqual({
      finished: false,
      reasons: [],
    })
  })

  it("Shipped with stock received is finished", () => {
    const v = assessInventoryOrderFinished({ ...base, status: "Shipped", received_quantity: 10 })
    expect(v.finished).toBe(true)
    expect(v.reasons[0]).toContain("stock received")
  })

  it("any posting finishes it, whatever the status (Partial, Processing)", () => {
    expect(assessInventoryOrderFinished({ ...base, status: "Partial", received_quantity: 0.5 }).finished).toBe(true)
    expect(assessInventoryOrderFinished({ ...base, status: "Processing", received_quantity: 3 }).finished).toBe(true)
  })

  it("a paid payout finishes it even before any receipt", () => {
    const v = assessInventoryOrderFinished({ ...base, status: "Shipped", paid_payout_ids: ["psub_1"] })
    expect(v.finished).toBe(true)
    expect(v.reasons).toEqual(["paid payout(s): psub_1"])
  })

  it("closed_as_received metadata finishes it", () => {
    const v = assessInventoryOrderFinished({
      ...base,
      status: "Shipped",
      metadata: { closed_as_received: { at: "2026-09-18" } },
    })
    expect(v.finished).toBe(true)
  })

  it("Pending / Processing / Cancelled with no evidence still roll back", () => {
    for (const status of ["Pending", "Processing", "Cancelled", "Ready for Delivery", null]) {
      expect(assessInventoryOrderFinished({ ...base, status }).finished).toBe(false)
    }
  })

  it("a zero or negative received quantity is not a posting", () => {
    expect(assessInventoryOrderFinished({ ...base, status: "Shipped", received_quantity: 0 }).finished).toBe(false)
    expect(assessInventoryOrderFinished({ ...base, status: "Shipped", received_quantity: -2 }).finished).toBe(false)
  })
})

describe("isFullyReceived", () => {
  it("true only when every line with a quantity is covered (±0.01)", () => {
    expect(isFullyReceived([{ quantity: 10, received: 10 }, { quantity: 4.5, received: 4.495 }])).toBe(true)
    expect(isFullyReceived([{ quantity: 10, received: 10 }, { quantity: 5, received: 4 }])).toBe(false)
  })

  it("an order with no real lines is never 'fully received'", () => {
    expect(isFullyReceived([])).toBe(false)
    expect(isFullyReceived([{ quantity: 0, received: 0 }])).toBe(false)
  })
})

describe("latestWorkflowRollbacks", () => {
  it("keeps only workflow_rollback rows, latest per order", () => {
    const rows = latestWorkflowRollbacks([
      { inventory_order_id: "o1", partner_id: "p_old", payload: { reason: "workflow_rollback" }, occurred_at: "2026-01-01" },
      { inventory_order_id: "o1", partner_id: "p_new", payload: { reason: "workflow_rollback" }, occurred_at: "2026-02-01" },
      { inventory_order_id: "o2", partner_id: "p2", payload: { reason: "admin_unassign" }, occurred_at: "2026-02-01" },
      { inventory_order_id: "o3", partner_id: "p3", payload: null, occurred_at: "2026-02-01" },
    ])
    expect(rows).toEqual([
      { inventory_order_id: "o1", partner_id: "p_new", occurred_at: "2026-02-01" },
    ])
  })
})
