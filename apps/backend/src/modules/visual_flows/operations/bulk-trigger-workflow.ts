import { z } from "@medusajs/framework/zod"
import { Modules } from "@medusajs/framework/utils"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

/**
 * Default TTL (seconds) for a per-item idempotency lock. Long enough to cover
 * the workflow trigger + a crash-recovery margin, short enough that a
 * genuinely failed item is retried on the next scheduled tick. The lock is
 * always released explicitly after the trigger resolves, so this is only the
 * crash-safety net.
 */
const IDEMPOTENCY_LOCK_TTL_SECONDS = 300

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
      .record(z.string(), z.any())
      .optional()
      .describe(
        "Input object passed to each workflow invocation. " +
        "Use {{ item.field }} for per-item values and $index for positional cross-array references."
      ),
    continue_on_error: z.boolean().optional().default(true),
    max_items: z.number().int().min(1).max(500).optional().default(100),
    /**
     * Per-item idempotency lock key template (#1334).
     *
     * When set, each item's workflow trigger is guarded by a distributed
     * lock (Modules.LOCKING) keyed on the interpolated template. If the lock
     * is already held — meaning another concurrent execution is processing
     * the same item — the item is skipped immediately (not queued).
     *
     * The template supports the same {{ item.field }} and $index
     * interpolation as `input_template`. Example:
     *   "cart-abandoned:{{ item.cart_id }}"
     *
     * Omit for workflows that don't need per-item idempotency (the original
     * behaviour — every item triggers its workflow unconditionally).
     */
    idempotency_key_template: z.string().optional(),
  }),

  defaultOptions: {
    workflow_name: "",
    items: [],
    input_template: {},
    continue_on_error: true,
    max_items: 100,
    idempotency_key_template: "",
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const continueOnError = Boolean(options.continue_on_error ?? true)
      const maxItems = Number(options.max_items ?? 100)
      const rawName = options.workflow_name ?? options.workflow_id ?? ""
      const workflowName = interpolateString(String(rawName), context.dataChain)
      const idempotencyTemplate = options.idempotency_key_template || null

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
        return { success: true, data: { triggered: 0, failed: 0, skipped: 0, records: [], results: [] } }
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

      // Resolve the locking service once if idempotency keys are in use.
      // `acquire` throws immediately when the lock is already held — the
      // caller skips the item instead of waiting, so two concurrent flow
      // executions can't both send for the same cart / entity. #1334.
      const locking = idempotencyTemplate
        ? (context.container.resolve(Modules.LOCKING) as any)
        : null

      const results: Array<{ index: number; ok: boolean; record?: any; error?: string; skipped?: boolean }> = []
      let skipped = 0

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

          // ── Per-item idempotency lock (#1334) ───────────────────────────────
          //
          // When `idempotency_key_template` is set, acquire a distributed lock
          // BEFORE triggering the workflow. `acquire` is non-blocking — it
          // succeeds immediately or throws if another execution holds the
          // lock. A skipped item means another concurrent execution is already
          // processing it, so we move on. The lock is released in a `finally`
          // after the trigger resolves, and carries an TTL as a crash-safety
          // net so a dead worker can't pin an item forever.
          let idempotencyKey: string | null = null
          if (idempotencyTemplate) {
            idempotencyKey = interpolateString(idempotencyTemplate, chainWithItem)
          }

          if (idempotencyKey && locking) {
            try {
              await locking.acquire(idempotencyKey, {
                expire: IDEMPOTENCY_LOCK_TTL_SECONDS,
              })
            } catch {
              // Lock already held — another execution is handling this item.
              skipped++
              results.push({ index: i, ok: false, error: "idempotency-skip", skipped: true })
              console.log(`[bulk_trigger_workflow] [${i}] skipped (idempotency lock held: ${idempotencyKey})`)
              continue
            }
          }

          try {
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
          } finally {
            if (idempotencyKey && locking) {
              try {
                await locking.release(idempotencyKey)
              } catch {
                // Best-effort release — the TTL will clean up if this fails.
              }
            }
          }
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
                skipped,
                records: results.filter((r) => r.ok).map((r) => r.record),
                results,
              },
            }
          }
        }
      }

      const triggered = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok && !r.skipped).length

      return {
        success: failed === 0 || continueOnError,
        data: {
          triggered,
          failed,
          skipped,
          records: results.filter((r) => r.ok).map((r) => r.record),
          results,
        },
      }
    } catch (error: any) {
      return { success: false, error: error.message, errorStack: error.stack }
    }
  },
}
