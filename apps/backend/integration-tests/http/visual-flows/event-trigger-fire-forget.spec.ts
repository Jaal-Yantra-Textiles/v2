import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import visualFlowEventTriggerHandler from "../../../src/subscribers/visual-flow-event-trigger"
import { createVisualFlowWorkflow } from "../../../src/workflows/visual-flows/create-visual-flow"
import { VISUAL_FLOWS_MODULE } from "../../../src/modules/visual_flows"

jest.setTimeout(60 * 1000)

// Compact canvas/op builders (mirror scheduled-enqueue.spec.ts).
const node = (id: string, type: string, options: Record<string, any> = {}) => ({
  id: `op_${id}`,
  type: "operation",
  position: { x: 0, y: 0 },
  data: { operationType: type, operationKey: `${type}_${id}`, options },
})
const edge = (s: string, t: string, sourceHandle = "default") => ({
  id: `${s}->${t}`,
  source: s === "trigger" ? "trigger" : `op_${s}`,
  target: `op_${t}`,
  sourceHandle,
})
const opRow = (id: string, type: string, sort: number) => ({
  operation_key: `${type}_${id}`,
  operation_type: type,
  name: `${type} ${id}`,
  options: {},
  position_x: 0,
  position_y: 0,
  sort_order: sort,
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const EVENT_NAME = "test.fire_forget.event"

async function createEventFlow(container: any, name: string) {
  const { result } = await createVisualFlowWorkflow(container).run({
    input: {
      name,
      status: "active",
      trigger_type: "event",
      trigger_config: { event_type: EVENT_NAME } as any,
      canvas_state: {
        nodes: [node("a", "log")],
        edges: [edge("trigger", "a")],
      },
      operations: [opRow("a", "log", 0)],
    },
  })
  return result.id as string
}

async function waitForCompletion(service: any, flowId: string) {
  for (let i = 0; i < 80; i++) {
    const execs: any[] = await service.listFlowExecutions(flowId)
    const done = execs.find(
      (e) => e.status === "completed" || e.status === "failed"
    )
    if (done) return done
    await sleep(250)
  }
  return null
}

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("visual-flows/event-trigger fire-and-forget (#459 P1 — slice 5)", () => {
    let container: any
    let service: any

    beforeEach(() => {
      container = getContainer()
      service = container.resolve(VISUAL_FLOWS_MODULE)
    })

    // ONE test on purpose: the medusa integration runner TRUNCATEs between
    // tests and that reset can deadlock against the @medusajs/index
    // CONCURRENTLY sync (the documented per-file boot deadlock). One test =
    // no intermediate reset. Polling to completion also drains the detached
    // (fire-and-forget) workflow writes before teardown TRUNCATE runs.
    it("dispatches every matching flow non-blocking and each completes", async () => {
      const flowA = await createEventFlow(container, "ff-flow-a")
      const flowB = await createEventFlow(container, "ff-flow-b")

      // The subscriber detaches each flow run (`void ...run()`) and returns
      // without awaiting — so the bus is never blocked by a slow/long-running
      // flow. The handler resolving quickly is structurally guaranteed by the
      // missing `await`; here we assert the behaviour it must preserve: every
      // matching flow is dispatched and runs to completion independently.
      await visualFlowEventTriggerHandler({
        event: { name: EVENT_NAME, data: { ping: "pong" } },
        container,
      } as any)

      // Both detached runs eventually complete — proving one flow does not
      // block the other and matching still dispatches every flow.
      const doneA = await waitForCompletion(service, flowA)
      const doneB = await waitForCompletion(service, flowB)
      expect(doneA?.status).toBe("completed")
      expect(doneB?.status).toBe("completed")
    })
  })
})
