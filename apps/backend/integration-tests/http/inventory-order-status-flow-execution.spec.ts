import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import visualFlowEventTriggerHandler from "../../src/subscribers/visual-flow-event-trigger"
import { VISUAL_FLOWS_MODULE } from "../../src/modules/visual_flows"
import { FLOW_DEF } from "../../src/scripts/seed-inventory-order-status-flow"

jest.setTimeout(60 * 1000)

/**
 * Execution-level integration for the #771/#788 inventory-order → WhatsApp flow.
 *
 * The install spec proves the flow gets CREATED; this proves it RUNS: firing the
 * real `inventory_orders.inventory-order.status-changed` event dispatches the
 * flow and it executes its whole graph (read_data → execute_code → condition →
 * log/send) to completion.
 *
 * We drive a deterministic, provider-independent path: the event targets an order
 * id that doesn't exist, so `resolve_message` returns `skipped` and the flow
 * takes the log branch — exercising matching + the full graph WITHOUT needing a
 * configured WhatsApp SocialPlatform (none exists in the test env). Asserting an
 * actual Meta send needs a seeded provider + approved template and is out of
 * scope here.
 *
 * ONE test on purpose: the medusa integration runner TRUNCATEs between tests and
 * that reset can deadlock the @medusajs/index CONCURRENTLY sync; polling to
 * completion also drains the detached (fire-and-forget) run before teardown.
 */
const EVENT_NAME = "inventory_orders.inventory-order.status-changed"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForCompletion(service: any, flowId: string) {
  for (let i = 0; i < 120; i++) {
    const execs: any[] = await service.listFlowExecutions(flowId)
    const done = execs.find((e) => e.status === "completed" || e.status === "failed")
    if (done) return done
    await sleep(250)
  }
  return null
}

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("inventory-order status flow — execution on status-changed (#771/#788)", () => {
    it("the status-changed event dispatches the flow and it runs to completion", async () => {
      const container = getContainer()
      const service: any = container.resolve(VISUAL_FLOWS_MODULE)

      // Install the real seeded flow, ACTIVE so the event subscriber matches it
      // (the installer/seed creates it as draft; the subscriber only runs active).
      const flow = await service.createCompleteFlow({
        flow: {
          name: FLOW_DEF.name,
          description: FLOW_DEF.description,
          status: "active",
          trigger_type: FLOW_DEF.trigger_type,
          trigger_config: FLOW_DEF.trigger_config,
          canvas_state: FLOW_DEF.canvas_state,
        },
        operations: FLOW_DEF.operations,
        connections: FLOW_DEF.connections,
      })
      const flowId = flow.id as string

      // Fire the real #776 event. No such order → resolve_message skips →
      // log branch → completes (no WhatsApp provider needed).
      await visualFlowEventTriggerHandler({
        event: {
          name: EVENT_NAME,
          data: {
            id: "inv_order_does_not_exist_xyz",
            previous_status: "Processing",
            status: "Shipped",
          },
        },
        container,
      } as any)

      const done = await waitForCompletion(service, flowId)
      // It MATCHED (the trigger_config event_types include the event) and RAN.
      // A null here means the event never matched the flow — the regression we
      // care about (event name / trigger_config drift).
      expect(done).not.toBeNull()
      expect(done.status).toBe("completed")
    })
  })
})
