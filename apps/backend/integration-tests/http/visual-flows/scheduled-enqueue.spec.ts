import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import runScheduledVisualFlows from "../../../src/jobs/run-scheduled-visual-flows"
import { createVisualFlowWorkflow } from "../../../src/workflows/visual-flows/create-visual-flow"
import { VISUAL_FLOWS_MODULE } from "../../../src/modules/visual_flows"

jest.setTimeout(60 * 1000)

// Compact canvas/op builders (mirror compile-on-save.spec.ts).
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

async function createScheduledFlow(container: any, name: string) {
  const { result } = await createVisualFlowWorkflow(container).run({
    input: {
      name,
      status: "active",
      trigger_type: "schedule",
      // "* * * * *" always matches the current minute, so the scanner picks it up.
      trigger_config: { cron: "* * * * *" } as any,
      canvas_state: {
        nodes: [node("a", "log")],
        edges: [edge("trigger", "a")],
      },
      operations: [opRow("a", "log", 0)],
    },
  })
  return result.id as string
}

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("visual-flows/scheduled-enqueue (#459 P1 — enqueue-and-ack)", () => {
    let container: any
    let service: any

    beforeEach(() => {
      container = getContainer()
      service = container.resolve(VISUAL_FLOWS_MODULE)
    })

    // Kept as ONE test on purpose: the medusa integration runner TRUNCATEs
    // between tests, and that reset can deadlock against the @medusajs/index
    // CONCURRENTLY index sync (the documented per-file boot deadlock). One test
    // = no intermediate reset.
    it("enqueues a due flow non-blocking, dedups within the minute, then completes", async () => {
      const flowId = await createScheduledFlow(container, "sched-enqueue-flow")

      // --- Tick 1: the marker must be written before the scanner returns,
      // proving the scanner does not wait on the (fire-and-forget) workflow. ---
      await runScheduledVisualFlows(container)

      const after1: any = await service.retrieveVisualFlow(flowId)
      const sched1 = after1?.metadata?.schedule
      expect(sched1).toBeTruthy()
      expect(sched1.last_run_minute_key).toBeTruthy()
      expect(["enqueued", "completed"]).toContain(sched1.last_status)
      const enqueuedAt1 = sched1.last_enqueued_at
      expect(enqueuedAt1).toBeTruthy()

      // --- Tick 2 (same minute): dedup on last_run_minute_key must skip, so
      // the enqueue-marker timestamp stays unchanged. ---
      await runScheduledVisualFlows(container)
      const after2: any = await service.retrieveVisualFlow(flowId)
      expect(after2?.metadata?.schedule?.last_enqueued_at).toBe(enqueuedAt1)

      // --- The fired workflow eventually completes and records its status.
      // Polling to completion also drains the background writes before the
      // suite teardown TRUNCATE runs. ---
      let final: any
      for (let i = 0; i < 60; i++) {
        const f: any = await service.retrieveVisualFlow(flowId)
        final = f?.metadata?.schedule
        if (final?.last_status === "completed" || final?.last_status === "failed") break
        await sleep(250)
      }
      expect(final?.last_status).toBe("completed")
      expect(final?.last_execution_id).toBeTruthy()
    })
  })
})
