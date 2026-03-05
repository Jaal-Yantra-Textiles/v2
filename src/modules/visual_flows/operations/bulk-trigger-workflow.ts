import { z } from "@medusajs/framework/zod"
import { Modules } from "@medusajs/framework/utils"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

/**
 * Substitute $index placeholder in a serialised template.
 * Mirrors the approach used in bulk-create-data.ts and bulk-http-request.ts.
 */
function substituteIndex(template: any, index: number): any {
  const str = JSON.stringify(template)
    .replace(/\$index/g, String(index))
    .replace(/\bindex\b(?=[^\w])/g, String(index))
  return JSON.parse(str)
}

export const bulkTriggerWorkflowOperation: OperationDefinition = {
  type: "bulk_trigger_workflow",
  name: "Bulk Trigger Workflow",
  description: "Trigger a Medusa workflow once per item in an array — no HTTP, no auth issues",
  icon: "play",
  category: "integration",

  optionsSchema: z.object({
    workflow_name: z.string().describe("Name of the workflow to call for each item"),
    /**
     * Array source — literal array or a {{ variable }} reference that resolves to one.
     */
    items: z
      .union([z.string(), z.array(z.any())])
      .describe("Array to iterate over, or a {{ variable }} reference"),
    /**
     * Input template for each workflow call.
     * Supports {{ item.field }} (current element) and $index.
     * All other {{ operation_key.field }} references to the data chain also work.
     */
    input_template: z
      .record(z.any())
      .optional()
      .describe(
        "Input object passed to each workflow invocation. " +
        "Use {{ item.field }} for per-item values and $index for positional cross-array references."
      ),
    continue_on_error: z.boolean().optional().default(true),
    max_items: z.number().int().min(1).max(500).optional().default(100),
  }),

  defaultOptions: {
    workflow_name: "",
    items: [],
    input_template: {},
    continue_on_error: true,
    max_items: 100,
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const continueOnError = Boolean(options.continue_on_error ?? true)
      const maxItems = Number(options.max_items ?? 100)
      const rawName = options.workflow_name ?? options.workflow_id ?? ""
      const workflowName = interpolateString(String(rawName), context.dataChain)

      if (!workflowName) {
        return { success: false, error: "workflow_name is required — select a workflow in the node properties panel" }
      }

      // ── Resolve items array ──────────────────────────────────────────────────
      const resolvedItems = interpolateVariables(options.items, context.dataChain)
      if (!Array.isArray(resolvedItems)) {
        return {
          success: false,
          error: `'items' did not resolve to an array. Got: ${typeof resolvedItems}`,
        }
      }

      if (resolvedItems.length === 0) {
        return { success: true, data: { triggered: 0, failed: 0, records: [], results: [] } }
      }

      if (resolvedItems.length > maxItems) {
        return {
          success: false,
          error: `Too many items (${resolvedItems.length}). Max allowed is ${maxItems}.`,
        }
      }

      const workflowEngine: IWorkflowEngineService = context.container.resolve(
        Modules.WORKFLOW_ENGINE
      )

      const results: Array<{ index: number; ok: boolean; record?: any; error?: string }> = []

      for (let i = 0; i < resolvedItems.length; i++) {
        const item = resolvedItems[i]

        try {
          // Build chain with current item + substitute $index before interpolating
          const chainWithItem = { ...context.dataChain, $item: item, item }

          let input: Record<string, any> = {}
          if (options.input_template && Object.keys(options.input_template).length > 0) {
            const templateWithIndex = substituteIndex(options.input_template, i)
            input = interpolateVariables(templateWithIndex, chainWithItem)
          }

          console.log(`[bulk_trigger_workflow] [${i}/${resolvedItems.length}] ${workflowName}`, { input })

          const { result, errors } = await workflowEngine.run(workflowName, {
            input,
            transactionId: `vflow-${context.executionId}-${workflowName}-${i}-${Date.now()}`,
            context: { requestId: context.executionId },
          })

          if (errors?.length) {
            const msg = errors.map((e: any) => e.error?.message || e.message || String(e)).join("; ")
            throw new Error(`Workflow error: ${msg}`)
          }

          results.push({ index: i, ok: true, record: result })
        } catch (e: any) {
          const error = e?.message || "Unknown error"
          console.error(`[bulk_trigger_workflow] [${i}] failed:`, error)
          results.push({ index: i, ok: false, error })

          if (!continueOnError) {
            return {
              success: false,
              error,
              data: {
                triggered: results.filter((r) => r.ok).length,
                failed: results.filter((r) => !r.ok).length,
                records: results.filter((r) => r.ok).map((r) => r.record),
                results,
              },
            }
          }
        }
      }

      const triggered = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok).length

      return {
        success: failed === 0 || continueOnError,
        data: {
          triggered,
          failed,
          records: results.filter((r) => r.ok).map((r) => r.record),
          results,
        },
      }
    } catch (error: any) {
      return { success: false, error: error.message, errorStack: error.stack }
    }
  },
}
