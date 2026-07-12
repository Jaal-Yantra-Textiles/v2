import { FLOW_DEF } from "../seed-winback-audience-refresh-flow"

/**
 * Structural guards for the weekly winback audience-refresh visual flow seed
 * (#450/#916). Editor-gated + op wired by STRING name, so a typo in the op type
 * or a job id would silently no-op at runtime — pin the contract here.
 */
describe("seed-winback-audience-refresh-flow FLOW_DEF", () => {
  it("is an ACTIVE weekly schedule flow at 0 2 * * 1", () => {
    expect(FLOW_DEF.status).toBe("active")
    expect(FLOW_DEF.trigger_type).toBe("schedule")
    expect(FLOW_DEF.trigger_config.cron).toBe("0 2 * * 1")
    expect(
      (FLOW_DEF.canvas_state.nodes[0].data as any).triggerConfig.cron
    ).toBe(FLOW_DEF.trigger_config.cron)
  })

  it("runs newsletter then churn winback jobs via run_maintenance_job (apply)", () => {
    const byKey = Object.fromEntries(
      FLOW_DEF.operations.map((o) => [o.operation_key, o])
    )
    expect(byKey.run_newsletter.operation_type).toBe("run_maintenance_job")
    expect((byKey.run_newsletter.options as any).job_id).toBe(
      "generate-newsletter-winback-targets"
    )
    expect((byKey.run_newsletter.options as any).dry_run).toBe(false)

    expect(byKey.run_churn.operation_type).toBe("run_maintenance_job")
    expect((byKey.run_churn.options as any).job_id).toBe("generate-winback-targets")
    expect((byKey.run_churn.options as any).dry_run).toBe(false)

    expect(byKey.log_summary.operation_type).toBe("log")
    expect(FLOW_DEF.operations.map((o) => o.sort_order)).toEqual([0, 1, 2])
  })

  it("has matching canvas edges and connection rows forming a linear chain", () => {
    const conn = FLOW_DEF.connections.map((c) => `${c.source_id}->${c.target_id}`)
    const edges = FLOW_DEF.canvas_state.edges.map((e) => `${e.source}->${e.target}`)
    expect(conn).toEqual(edges)
    expect(conn).toEqual([
      "trigger->run_newsletter",
      "run_newsletter->run_churn",
      "run_churn->log_summary",
    ])
  })

  it("logs the summary keys emitted by each run_maintenance_job node", () => {
    const log = FLOW_DEF.operations.find(
      (o) => o.operation_key === "log_summary"
    )!.options as any
    expect(log.message).toContain("{{ run_newsletter.summary }}")
    expect(log.message).toContain("{{ run_churn.summary }}")
  })
})
