import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  transform,
  WorkflowData,
} from "@medusajs/framework/workflows-sdk"
import { VISUAL_FLOWS_MODULE } from "../../modules/visual_flows"
import VisualFlowService from "../../modules/visual_flows/service"

/**
 * #459 P1 — durable long-running wait for visual flows.
 *
 * Proves the suspend/resume primitive the future executor will use for
 * `wait_for_event` nodes, WITHOUT touching the live single-step executor. The
 * middle step is a Medusa async step (returns no StepResponse) so the workflow
 * SUSPENDS in the workflow engine holding no process — resumed by the resume
 * route (setStepSuccess) or cancelled on timeout. State is mirrored onto a
 * visual_flow_execution row (running → completed) so the wait is observable in
 * the flow's own execution model.
 *
 * Docs: https://docs.medusajs.com/learn/fundamentals/workflows/long-running-workflow
 */

export const flowWaitWorkflowId = "visual-flow-wait"
export const waitForFlowResumeStepId = "wait-for-flow-resume"

export type FlowWaitInput = {
  flowId: string
  waitKey?: string
  triggeredBy?: string
}

/** Step 1 (sync): open an execution row in `running` state and log the wait. */
const recordFlowWaitStartStep = createStep(
  "record-flow-wait-start",
  async (input: FlowWaitInput, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    const execution = await service.createExecution({
      flow_id: input.flowId,
      triggered_by: input.triggeredBy || "wait",
      metadata: { wait_key: input.waitKey ?? null },
    })
    await service.updateExecutionStatus(execution.id, "running", {})
    await service.addExecutionLog({
      execution_id: execution.id,
      operation_key: "$wait",
      status: "running",
      input_data: { wait_key: input.waitKey ?? null },
    })
    return new StepResponse(execution.id, execution.id)
  },
  // Compensation: if a later step fails (or the wait times out), mark cancelled.
  async (executionId, { container }) => {
    if (!executionId) return
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    await service.updateExecutionStatus(executionId, "cancelled", {})
  }
)

/**
 * Step 2 (async / long-running): no StepResponse → the workflow suspends here
 * until setStepSuccess/Failure is called. `timeout` bounds an orphaned wait.
 */
const waitForFlowResumeStep = createStep(
  {
    name: waitForFlowResumeStepId,
    async: true,
    timeout: 60 * 60 * 24, // 24h ceiling for an un-resumed wait
  },
  async () => {
    // Intentionally returns nothing — see step comment.
  }
)

/** Step 3 (sync): record the resume + close the execution row. */
const recordFlowWaitCompleteStep = createStep(
  "record-flow-wait-complete",
  async (input: { executionId: string; resume: any }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    await service.addExecutionLog({
      execution_id: input.executionId,
      operation_key: "$wait",
      status: "success",
      output_data: { resumed: true, payload: input.resume ?? null },
    })
    await service.updateExecutionStatus(input.executionId, "completed", {
      data_chain: { $wait: { resumed: true, payload: input.resume ?? null } } as any,
    })
    return new StepResponse({
      executionId: input.executionId,
      resumed: true,
      payload: input.resume ?? null,
    })
  }
)

export const flowWaitWorkflow = createWorkflow(
  { name: flowWaitWorkflowId, store: true },
  (input: WorkflowData<FlowWaitInput>) => {
    const executionId = recordFlowWaitStartStep(input)

    // Suspends here until resumed; its output is whatever setStepSuccess passes.
    const resume = waitForFlowResumeStep()

    const completeInput = transform(
      { executionId, resume },
      (data) => ({ executionId: data.executionId, resume: data.resume })
    )
    const summary = recordFlowWaitCompleteStep(completeInput)

    return new WorkflowResponse(summary)
  }
)

export default flowWaitWorkflow
