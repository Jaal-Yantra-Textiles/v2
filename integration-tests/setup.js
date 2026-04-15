// Short lifecycle workflow timeouts for tests so async steps fail fast
process.env.PRODUCTION_RUN_AWAIT_TIMEOUT_SECONDS = "5"
// Disable Mastra AI connections in tests — not being tested
process.env.MASTRA_DISABLED = "true"

// Replace waitWorkflowExecutions: wait briefly, then force-fail stuck async
// steps so the workflow engine can reach a terminal state. Uses the Medusa
// setStepFailure API per the docs for long-running workflow testing.
try {
  const { Modules, TransactionHandlerType } = require("@medusajs/framework/utils")
  const { StepResponse } = require("@medusajs/framework/workflows-sdk")
  const wweModule = require("@medusajs/test-utils/dist/medusa-test-runner-utils/wait-workflow-executions")

  // Known async step IDs that may be stuck after tests
  const ASYNC_STEPS = [
    { workflowId: "run-production-run-lifecycle", stepId: "await-run-start" },
    { workflowId: "run-production-run-lifecycle", stepId: "await-run-finish" },
    { workflowId: "run-production-run-lifecycle", stepId: "await-run-complete" },
    { workflowId: "dispatch-production-run", stepId: "wait-dispatch-template-selection" },
  ]

  wweModule.waitWorkflowExecutions = async function patchedWaitWorkflowExecutions(container) {
    const wfe = container.resolve(Modules.WORKFLOW_ENGINE, { allowUnregistered: true })
    if (!wfe) return

    // Wait up to 8s for workflows to finish naturally
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const executions = await wfe.listWorkflowExecutions({
        state: { $nin: ["not_started", "done", "reverted", "failed"] },
      })
      if (executions.length === 0) return
      await new Promise((r) => setTimeout(r, 100))
    }

    // Force-fail stuck async steps
    const stuck = await wfe.listWorkflowExecutions({
      state: { $nin: ["not_started", "done", "reverted", "failed"] },
    })

    for (const exec of stuck) {
      for (const { workflowId, stepId } of ASYNC_STEPS) {
        if (exec.workflow_id !== workflowId) continue
        try {
          await wfe.setStepFailure({
            idempotencyKey: {
              action: TransactionHandlerType.INVOKE,
              transactionId: exec.transaction_id,
              stepId,
              workflowId,
            },
            stepResponse: new StepResponse("Test cleanup"),
            options: { throwOnError: false },
          })
        } catch {
          // Step may not be the active one — skip
        }
      }
    }

    // Wait up to 5s for failed workflows to settle
    const settleDeadline = Date.now() + 5000
    while (Date.now() < settleDeadline) {
      const remaining = await wfe.listWorkflowExecutions({
        state: { $nin: ["not_started", "done", "reverted", "failed"] },
      })
      if (remaining.length === 0) return
      await new Promise((r) => setTimeout(r, 100))
    }
  }
} catch {
  // Module not available — skip patch
}

const { MetadataStorage } = require("@mikro-orm/core")

jest.mock(
  "@sindresorhus/slugify",
  () => {
    return {
      __esModule: true,
      default: (str) => (str || "").toLowerCase().replace(/\s+/g, "-"),
    }
  },
  { virtual: true },
  
)

jest.mock("p-map", () => {
    return {
        __esModule: true,
        default: async (iterable, mapper) => Promise.all(iterable.map(mapper)),
    }
}, { virtual: true })

MetadataStorage.clear()