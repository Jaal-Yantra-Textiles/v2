import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { VISUAL_FLOWS_MODULE } from "../../../src/modules/visual_flows"
import type VisualFlowService from "../../../src/modules/visual_flows/service"
import seedFxRefreshFlow from "../../../src/scripts/seed-fx-refresh-flow"

jest.setTimeout(60 * 1000)

// Verifies the seed script creates the expected visual flow shape:
// schedule trigger on cron "0 2 * * *", single trigger_workflow op
// pointing at "refresh-fx-rates", connections wired correctly,
// idempotent on re-run.

const FLOW_NAME = "FX Rates — Daily Refresh"

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("scripts/seed-fx-refresh-flow", () => {
    let svc: VisualFlowService
    let container: any

    beforeEach(async () => {
      container = getContainer()
      svc = container.resolve(VISUAL_FLOWS_MODULE) as VisualFlowService
      // Test runner truncates between tests; no manual cleanup needed.
    })

    it("creates the daily-refresh flow with schedule trigger and trigger_workflow op", async () => {
      await seedFxRefreshFlow({ container } as any)

      const [flow] = (await svc.listVisualFlows({ name: FLOW_NAME } as any)) as any[]
      expect(flow).toBeDefined()
      expect(flow.status).toBe("draft")
      expect(flow.trigger_type).toBe("schedule")
      expect(flow.trigger_config).toMatchObject({ cron: "0 2 * * *" })

      // Pull operations + connections via the service's getter and
      // verify the single trigger_workflow op is wired right.
      const operations = await (svc as any).getFlowOperations(flow.id)
      const connections = await (svc as any).getFlowConnections(flow.id)
      expect(operations).toHaveLength(1)

      const op = operations[0]
      expect(op.operation_key).toBe("refresh_rates")
      expect(op.operation_type).toBe("trigger_workflow")
      expect(op.options).toMatchObject({
        workflow_name: "refresh-fx-rates",
        wait_for_completion: true,
      })

      // Single connection from trigger to the refresh op.
      expect(connections).toHaveLength(1)
      expect(connections[0]).toMatchObject({
        source_id: "trigger",
        target_id: "refresh_rates",
        connection_type: "default",
      })
    })

    it("is idempotent — re-running skips if a flow with the same name exists", async () => {
      await seedFxRefreshFlow({ container } as any)
      const first = (await svc.listVisualFlows({ name: FLOW_NAME } as any)) as any[]
      expect(first).toHaveLength(1)

      await seedFxRefreshFlow({ container } as any)
      const second = (await svc.listVisualFlows({ name: FLOW_NAME } as any)) as any[]
      expect(second).toHaveLength(1)
      expect(second[0].id).toBe(first[0].id)
    })
  })
})
