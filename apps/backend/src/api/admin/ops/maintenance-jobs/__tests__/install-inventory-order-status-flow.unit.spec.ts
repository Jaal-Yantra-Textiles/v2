import { summarizeEventFlowInstall } from "../registry"

const EVENT = "inventory_orders.inventory-order.status-changed"

describe("install-inventory-order-status-flow — summarizeEventFlowInstall", () => {
  it("reports already-installed when existingId is set (dry-run, no apply)", () => {
    const result = summarizeEventFlowInstall({
      jobId: "install-inventory-order-status-flow",
      dry_run: true,
      flowName: "Partner WhatsApp — Inventory Order Status",
      eventTrigger: EVENT,
      nodeCount: 6,
      existingId: "vf_existing",
      createdId: null,
    })
    expect(result.applied).toBe(false)
    expect(result.changes).toEqual([])
    expect(result.summary).toMatch(/already installed/)
    expect(result.summary).toContain("vf_existing")
    expect(result.summary).toContain(EVENT)
    expect(result.job_id).toBe("install-inventory-order-status-flow")
  })

  it("reports would-create when dry-run and not existing", () => {
    const result = summarizeEventFlowInstall({
      jobId: "jid",
      dry_run: true,
      flowName: "My Flow",
      eventTrigger: EVENT,
      nodeCount: 6,
      existingId: null,
      createdId: null,
    })
    expect(result.applied).toBe(false)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].entity).toBe("visual_flow")
    expect(result.changes[0].field).toBe("created")
    expect(result.changes[0].id).toBe("(new)")
    expect(result.summary).toMatch(/Would create/)
    expect(result.summary).toContain("My Flow")
    expect(result.summary).toContain(EVENT)
    expect(result.summary).toContain("6")
  })

  it("reports created when apply succeeds with a new id", () => {
    const result = summarizeEventFlowInstall({
      jobId: "jid",
      dry_run: false,
      flowName: "My Flow",
      eventTrigger: EVENT,
      nodeCount: 6,
      existingId: null,
      createdId: "vf_new",
    })
    expect(result.applied).toBe(true)
    expect(result.changes[0].id).toBe("vf_new")
    expect(result.summary).toMatch(/Created/)
    expect(result.summary).toContain("vf_new")
    // nudges the operator toward the two go-live steps.
    expect(result.summary).toContain("jyt_inventory_order_status_v1")
  })

  it("reports not applied when createdId is null on apply", () => {
    const result = summarizeEventFlowInstall({
      jobId: "jid",
      dry_run: false,
      flowName: "My Flow",
      eventTrigger: EVENT,
      nodeCount: 6,
      existingId: null,
      createdId: null,
    })
    expect(result.applied).toBe(false)
    expect(result.changes[0].id).toBe("(new)")
  })
})
