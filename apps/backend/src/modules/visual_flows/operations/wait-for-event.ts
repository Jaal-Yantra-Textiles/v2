import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"

/**
 * #459 P1 — Wait For Event (durable wait node).
 *
 * Marks a point in a flow where execution should SUSPEND until an external
 * signal arrives (an event, a webhook, a human approval) or a timeout elapses.
 *
 * The actual durable suspend/resume is implemented by the long-running
 * `flowWaitWorkflow` (src/workflows/visual-flows/flow-wait.ts), which uses a
 * Medusa async step so the flow holds NO process while waiting and survives a
 * restart — unlike the old `sleep` op (capped at 5s, lost on restart). This
 * handler is the graph-node representation: it validates/echoes the wait config
 * so the node exists in the registry and compiles. Full executor integration
 * (pausing the running graph on this node) is the next slice.
 */
export const waitForEventOperation: OperationDefinition = {
  type: "wait_for_event",
  name: "Wait For Event",
  description:
    "Suspend the flow until an external event/webhook/approval resumes it (or it times out). Durable — survives restarts.",
  icon: "clock",
  category: "logic",

  optionsSchema: z.object({
    wait_key: z
      .string()
      .optional()
      .describe("Correlation key the resuming signal must reference"),
    event: z
      .string()
      .optional()
      .describe("Optional event name expected to resume this wait"),
    timeout_seconds: z
      .number()
      .optional()
      .default(60 * 60 * 24)
      .describe("Max time to wait before the wait is cancelled (default 24h)"),
  }),

  defaultOptions: {
    timeout_seconds: 60 * 60 * 24,
  },

  execute: async (options, _context: OperationContext): Promise<OperationResult> => {
    // Marker semantics in the synchronous executor: surface the resolved wait
    // config so downstream nodes / the future durable driver can act on it.
    return {
      success: true,
      data: {
        _wait: true,
        wait_key: options.wait_key ?? null,
        event: options.event ?? null,
        timeout_seconds: options.timeout_seconds ?? 60 * 60 * 24,
      },
    }
  },
}
