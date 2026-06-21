import { FLOW_DEF } from "../seed-partner-analytics-digest-flow"

/**
 * Structural guards for the weekly partner-digest visual flow seed (#581 S4).
 *
 * This flow is editor-gated and cannot be live-verified by the daemon, and it
 * wires the S3 op + S2 workflow by STRING name only. A typo in either string
 * would silently no-op at runtime, so these tests pin the contract.
 */
describe("seed-partner-analytics-digest-flow FLOW_DEF", () => {
  it("is a weekly schedule-triggered draft flow", () => {
    expect(FLOW_DEF.status).toBe("draft")
    expect(FLOW_DEF.trigger_type).toBe("schedule")
    // Weekly Monday cron (day-of-week field = 1, single value, not a range).
    expect(FLOW_DEF.trigger_config.cron).toBe("30 3 * * 1")
    expect(
      (FLOW_DEF.canvas_state.nodes[0].data as any).triggerConfig.cron
    ).toBe(FLOW_DEF.trigger_config.cron)
  })

  it("wires compute → send → log via partner_analytics_digest + bulk_trigger", () => {
    const byKey = Object.fromEntries(
      FLOW_DEF.operations.map((o) => [o.operation_key, o])
    )
    expect(byKey.compute_digests.operation_type).toBe("partner_analytics_digest")
    expect(byKey.send_digests.operation_type).toBe("bulk_trigger_workflow")
    expect(byKey.log_summary.operation_type).toBe("log")

    // sort_order is contiguous from 0 in execution order.
    expect(FLOW_DEF.operations.map((o) => o.sort_order)).toEqual([0, 1, 2])
  })

  it("targets the S2 send-partner-digest-email workflow with the digest payload", () => {
    const send = FLOW_DEF.operations.find(
      (o) => o.operation_key === "send_digests"
    )!.options as any
    expect(send.workflow_name).toBe("send-partner-digest-email")
    // Items pull the op's digests[] output; each item is fed as { digest }.
    expect(send.items).toBe("{{ compute_digests.digests }}")
    expect(send.input_template).toEqual({ digest: "{{ item }}" })
    expect(send.continue_on_error).toBe(true)
  })

  it("computes a weekly digest for all active partners (no explicit selector)", () => {
    const compute = FLOW_DEF.operations.find(
      (o) => o.operation_key === "compute_digests"
    )!.options as any
    expect(compute.period).toBe("last_7_days")
    expect(compute.partner_id).toBeUndefined()
    expect(compute.partner_ids).toBeUndefined()
    expect(compute.continue_on_error).toBe(true)
  })

  it("keeps op max_partners and send max_items aligned so neither truncates", () => {
    const compute = FLOW_DEF.operations.find(
      (o) => o.operation_key === "compute_digests"
    )!.options as any
    const send = FLOW_DEF.operations.find(
      (o) => o.operation_key === "send_digests"
    )!.options as any
    expect(compute.max_partners).toBe(send.max_items)
  })

  it("has matching canvas edges and connection rows forming a linear chain", () => {
    // connections (persisted graph) and canvas edges (editor view) agree.
    const conn = FLOW_DEF.connections.map((c) => `${c.source_id}->${c.target_id}`)
    const edges = FLOW_DEF.canvas_state.edges.map((e) => `${e.source}->${e.target}`)
    expect(conn).toEqual(edges)
    expect(conn).toEqual([
      "trigger->compute_digests",
      "compute_digests->send_digests",
      "send_digests->log_summary",
    ])
  })

  it("logs the real output keys emitted by the two ops", () => {
    const log = FLOW_DEF.operations.find(
      (o) => o.operation_key === "log_summary"
    )!.options as any
    // digest op output keys
    expect(log.message).toContain("{{ compute_digests.count }}")
    expect(log.message).toContain("{{ compute_digests.suggestion_count }}")
    expect(log.message).toContain("{{ compute_digests.failed }}")
    // bulk_trigger_workflow output keys
    expect(log.message).toContain("{{ send_digests.triggered }}")
    expect(log.message).toContain("{{ send_digests.failed }}")
  })
})
