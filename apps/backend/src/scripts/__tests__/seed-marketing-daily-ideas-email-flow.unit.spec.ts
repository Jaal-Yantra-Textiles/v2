import { FLOW_DEF } from "../seed-marketing-daily-ideas-email-flow"

/**
 * Structural guards for the daily ideas-email visual flow seed (#659 slice 2).
 *
 * The flow is editor-gated and cannot be live-verified by the daemon, and it
 * wires the operation by STRING name only. A typo in the op type would silently
 * no-op at runtime, so these tests pin the contract + the log node's keys.
 */
describe("seed-marketing-daily-ideas-email-flow FLOW_DEF", () => {
  it("is a daily schedule-triggered draft flow at 30 1 * * *", () => {
    expect(FLOW_DEF.status).toBe("draft")
    expect(FLOW_DEF.trigger_type).toBe("schedule")
    expect(FLOW_DEF.trigger_config.cron).toBe("30 1 * * *")
    expect(
      (FLOW_DEF.canvas_state.nodes[0].data as any).triggerConfig.cron
    ).toBe(FLOW_DEF.trigger_config.cron)
  })

  it("wires run_ideas → log via marketing_daily_ideas_email", () => {
    const byKey = Object.fromEntries(
      FLOW_DEF.operations.map((o) => [o.operation_key, o])
    )
    expect(byKey.run_ideas.operation_type).toBe("marketing_daily_ideas_email")
    expect(byKey.log_summary.operation_type).toBe("log")
    expect(FLOW_DEF.operations.map((o) => o.sort_order)).toEqual([0, 1])
  })

  it("seeds send OFF (no send_enabled option → env gate decides)", () => {
    const run = FLOW_DEF.operations.find(
      (o) => o.operation_key === "run_ideas"
    )!.options as any
    expect(run.send_enabled).toBeUndefined()
    expect(run.recipients).toBeUndefined()
  })

  it("has matching canvas edges and connection rows forming a linear chain", () => {
    const conn = FLOW_DEF.connections.map((c) => `${c.source_id}->${c.target_id}`)
    const edges = FLOW_DEF.canvas_state.edges.map((e) => `${e.source}->${e.target}`)
    expect(conn).toEqual(edges)
    expect(conn).toEqual(["trigger->run_ideas", "run_ideas->log_summary"])
  })

  it("logs the real summary keys emitted by the op", () => {
    const log = FLOW_DEF.operations.find(
      (o) => o.operation_key === "log_summary"
    )!.options as any
    for (const key of [
      "{{ run_ideas.generated }}",
      "{{ run_ideas.guard_passed }}",
      "{{ run_ideas.log_id }}",
      "{{ run_ideas.send_enabled }}",
      "{{ run_ideas.sent }}",
      "{{ run_ideas.skipped_reason }}",
      "{{ run_ideas.errored }}",
    ]) {
      expect(log.message).toContain(key)
    }
  })
})
