import { Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import {
  flowWaitWorkflow,
  flowWaitWorkflowId,
  waitForFlowResumeStepId,
} from "../../../src/workflows/visual-flows/flow-wait"
import { VISUAL_FLOWS_MODULE } from "../../../src/modules/visual_flows"

// Long-running workflow test. Generous ceiling, but every path RESUMES the
// workflow explicitly and polls with a bounded loop — it finishes or fails,
// never hangs. (setup.js also force-fails orphaned async steps as a backstop.)
jest.setTimeout(90 * 1000)

// Bounded poll: resolve when predicate true, else throw after maxMs. Never hangs.
async function waitFor<T>(
  fn: () => Promise<T>,
  pred: (v: T) => boolean,
  { maxMs = 15000, stepMs = 250 } = {}
): Promise<T> {
  const deadline = Date.now() + maxMs
  let last: T
  // eslint-disable-next-line no-constant-condition
  while (true) {
    last = await fn()
    if (pred(last)) return last
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${maxMs}ms (last=${JSON.stringify(last)?.slice(0, 200)})`)
    }
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("visual-flows/flow-wait long-running (#459 P1)", () => {
    let container: any
    let service: any
    let workflowEngine: any

    beforeEach(() => {
      container = getContainer()
      service = container.resolve(VISUAL_FLOWS_MODULE)
      workflowEngine = container.resolve(Modules.WORKFLOW_ENGINE)
    })

    const makeFlow = async (name: string) =>
      service.createVisualFlows({ name, trigger_type: "manual", status: "active" })

    // wait_for_event registry/compile coverage lives in the compiler unit test
    // (no booted app needed); here we focus on the durable suspend/resume.

    it("suspends on the async step, then resumes to completion via setStepSuccess", async () => {
      const flow = await makeFlow("flow-wait-resume")

      // Start: async step → run() resolves while the workflow is SUSPENDED.
      const { transaction } = await flowWaitWorkflow(container).run({
        input: { flowId: flow.id, waitKey: "order-shipped", triggeredBy: "test" },
      })
      const transactionId = transaction.transactionId
      expect(transactionId).toBeTruthy()

      // Step 1 already opened the execution row; it should be `running` (waiting).
      const [execution] = await service.listVisualFlowExecutions({ flow_id: flow.id } as any)
      expect(execution).toBeTruthy()
      expect(execution.status).toBe("running")

      // Resume — exactly what the resume route does (setStepSuccess + payload).
      await workflowEngine.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId,
          stepId: waitForFlowResumeStepId,
          workflowId: flowWaitWorkflowId,
        },
        stepResponse: new StepResponse({ ok: true, awb: "AWB123" }),
      })

      // Bounded-poll the execution row to completion (never hangs).
      const done = await waitFor(
        () => service.retrieveVisualFlowExecution(execution.id),
        (e: any) => e.status === "completed" || e.status === "failed"
      )
      expect(done.status).toBe("completed")
      expect(done.data_chain?.$wait?.resumed).toBe(true)
      expect(done.data_chain?.$wait?.payload?.awb).toBe("AWB123")
    })

    it("can resume immediately (no race when the signal beats the poll)", async () => {
      const flow = await makeFlow("flow-wait-fast")
      const { transaction } = await flowWaitWorkflow(container).run({
        input: { flowId: flow.id, triggeredBy: "test" },
      })

      await workflowEngine.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: transaction.transactionId,
          stepId: waitForFlowResumeStepId,
          workflowId: flowWaitWorkflowId,
        },
        stepResponse: new StepResponse(true),
      })

      const [execution] = await service.listVisualFlowExecutions({ flow_id: flow.id } as any)
      const done = await waitFor(
        () => service.retrieveVisualFlowExecution(execution.id),
        (e: any) => e.status === "completed" || e.status === "failed"
      )
      expect(done.status).toBe("completed")
      expect(done.data_chain?.$wait?.resumed).toBe(true)
    })
  })
})
