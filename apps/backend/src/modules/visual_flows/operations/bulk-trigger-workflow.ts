import { z } from "@medusajs/framework/zod"
import { Modules } from "@medusajs/framework/utils"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

/**
 * TTL (seconds) for a per-item idempotency key.
 *
 * This is the DEDUP WINDOW, not a mutex hold — which is why the key is not
 * released after a successful trigger. Two racing executions walk the same item
 * list serially, so the second one reaches a given item seconds or minutes
 * after the first finished it; a key released on success is simply gone by
 * then, and the item sends twice. The key has to outlive the window in which a
 * duplicate could still arrive.
 *
 * An hour comfortably covers a rolling ECS deploy (the window in which two
 * scanners coexist) while staying far shorter than the hourly cart-recovery
 * cadence's own per-cart guard (`recovery_email_count` / `recovery_email_sent_at`),
 * which remains the durable record. A key is released early only when the
 * trigger FAILED, so a cart whose mail never went out is retried at once
 * rather than being blacklisted for the window.
 */
const IDEMPOTENCY_LOCK_TTL_SECONDS = 3600

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
     * When set, each item's trigger claims a distributed key (Modules.LOCKING)
     * built from the interpolated template. A key that is already claimed means
     * another execution has ALREADY TRIGGERED this item — within the last
     * IDEMPOTENCY_LOCK_TTL_SECONDS — so the item is skipped, not queued.
     *
     * The key is held for the whole dedup window rather than released after the
     * trigger: the racing execution arrives late, not simultaneously (see the
     * TTL note above). It IS released early when the trigger fails, so a failed
     * item is retried immediately.
     *
     * Supports {{ item.field }} interpolation (NOT $index, which is applied to
     * `input_template` only — a key containing it would stay literal and
     * collapse every item onto one key). Example:
     *   "cart-abandoned:{{ item.cart_id }}"
     *
     * The interpolated key must be non-empty and fully resolved; an
     * unresolvable path would otherwise silently collapse every item onto the
     * same key and drop all but the first.
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

          // ── Per-item idempotency key (#1334) ────────────────────────────
          //
          // Claim the key BEFORE triggering. A claimed key means this item was
          // already triggered inside the dedup window, so we skip it.
          //
          // The claim is NOT released on success: the racing execution reaches
          // this item late (both walk the list serially), so a key released the
          // moment the trigger resolved would already be gone when the
          // duplicate arrives. It IS released when the trigger fails, so a send
          // that never happened can be retried at once.
          let idempotencyKey: string | null = null
          if (idempotencyTemplate) {
            idempotencyKey = interpolateString(idempotencyTemplate, chainWithItem)

            // `interpolateString` substitutes "" for a path it cannot resolve.
            // Left alone, a typo'd template collapses every item onto one key —
            // one item sends and the rest are reported as idempotency skips —
            // and a fully unresolved template yields "", which is falsy and so
            // disables the guard entirely. Both fail silently, in the direction
            // of sending nothing while claiming success.
            if (!idempotencyKey || idempotencyKey === idempotencyTemplate) {
              throw new Error(
                `idempotency_key_template "${idempotencyTemplate}" did not resolve for item ${i} — ` +
                  `check the field names on the items feeding this operation`
              )
            }
          }

          if (idempotencyKey && locking) {
            try {
              await locking.acquire(idempotencyKey, {
                expire: IDEMPOTENCY_LOCK_TTL_SECONDS,
              })
            } catch (lockError: any) {
              // CONFLICT is contention — the item is genuinely already handled.
              // Anything else (Redis unreachable, timeout) is infrastructure
              // failing, and reading it as "already sent" would turn a total
              // send outage into `success: true` with every item reported as a
              // tidy skip.
              const isContention =
                lockError?.type === "conflict" ||
                lockError?.type === "not_allowed" ||
                /failed to acquire lock/i.test(lockError?.message ?? "")

              if (!isContention) {
                throw new Error(
                  `Locking backend unavailable while claiming "${idempotencyKey}": ` +
                    `${lockError?.message || lockError}`
                )
              }

              skipped++
              results.push({ index: i, ok: false, error: "idempotency-skip", skipped: true })
              console.log(`[bulk_trigger_workflow] [${i}] skipped (already triggered: ${idempotencyKey})`)
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
          } catch (triggerError) {
            // Failed send → drop the claim so the next execution can retry.
            // A successful send keeps it until the TTL expires.
            if (idempotencyKey && locking) {
              try {
                await locking.release(idempotencyKey)
              } catch {
                // Best-effort — the TTL will clean up if this fails.
              }
            }
            throw triggerError
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
                // Excludes skips, matching the normal return below — counting
                // them here reported failures that never happened.
                failed: results.filter((r) => !r.ok && !r.skipped).length,
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
