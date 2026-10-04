import {
  ContainerRegistrationKeys,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"

/**
 * #2324 — tell a waiting send-to-partner workflow that its order is done.
 *
 * The partner start/complete routes signal `await-order-start` /
 * `await-order-completion`. Admin receive and the close-received job finish an
 * order through other doors, which never did — so the workflow sat until its
 * 23-day timeout and then compensated (un-linking the partner).
 *
 * 🔴 Best-effort, always. This never throws: an order sent before the workflow
 * existed, one whose transaction already finished or timed out, or one never
 * sent to a partner at all has nothing to signal, and none of that may fail
 * the receipt that called it.
 *
 * Literal name, not an import of the workflow: importing send-to-partner here
 * would make every receipt path load the whole partner workflow graph.
 */
export const SEND_TO_PARTNER_WORKFLOW_ID = "send-inventory-order-to-partner"

const AWAIT_STEPS = ["await-order-start", "await-order-completion"] as const

export type SignalOutcome = {
  transaction_id: string
  step_id: string
  ok: boolean
  error?: string
}

export type SignalPartnerWorkflowResult = {
  transaction_ids: string[]
  outcomes: SignalOutcome[]
}

/**
 * Every send-to-partner transaction that may still be waiting on this order:
 * the transaction ids stamped on its partner tasks (what the partner routes
 * use) plus any in-flight execution whose input names the order.
 */
export async function findPartnerWorkflowTransactionIds(
  container: any,
  orderId: string
): Promise<string[]> {
  const ids = new Set<string>()

  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "tasks.transaction_id"],
      filters: { id: orderId },
    })
    for (const o of (data ?? []) as any[]) {
      for (const t of (o?.tasks ?? []) as any[]) {
        if (t?.transaction_id) ids.add(String(t.transaction_id))
      }
    }
  } catch {
    // fall through to the execution table
  }

  try {
    const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const res = await pg.raw(
      `select transaction_id
         from workflow_execution
        where workflow_id = ?
          and state = 'invoking'
          and deleted_at is null
          and context->'data'->'payload'->>'inventoryOrderId' = ?`,
      [SEND_TO_PARTNER_WORKFLOW_ID, orderId]
    )
    for (const r of (res?.rows ?? []) as any[]) {
      if (r?.transaction_id) ids.add(String(r.transaction_id))
    }
  } catch {
    // no execution table (or no access) — tasks are the primary source anyway
  }

  return Array.from(ids)
}

export async function signalPartnerWorkflowFinished(
  container: any,
  orderId: string,
  source: string
): Promise<SignalPartnerWorkflowResult> {
  const outcomes: SignalOutcome[] = []
  let transactionIds: string[] = []
  let logger: any = null
  try {
    logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = null
  }

  try {
    transactionIds = await findPartnerWorkflowTransactionIds(container, orderId)
    if (!transactionIds.length) {
      return { transaction_ids: [], outcomes }
    }
    const engine: any = container.resolve(Modules.WORKFLOW_ENGINE)

    for (const transactionId of transactionIds) {
      // In order: succeeding `await-order-start` runs the transaction on to
      // `await-order-completion`, which is then the one waiting. A step that is
      // not waiting (already signalled, or the transaction is gone) is refused
      // by the engine — recorded, never thrown.
      for (const stepId of AWAIT_STEPS) {
        try {
          await engine.setStepSuccess({
            idempotencyKey: {
              action: TransactionHandlerType.INVOKE,
              transactionId,
              stepId,
              workflowId: SEND_TO_PARTNER_WORKFLOW_ID,
            },
            stepResponse: new StepResponse(
              { id: orderId, signalled_by: source },
              orderId
            ),
          })
          outcomes.push({ transaction_id: transactionId, step_id: stepId, ok: true })
        } catch (e: any) {
          outcomes.push({
            transaction_id: transactionId,
            step_id: stepId,
            ok: false,
            error: e?.message ?? String(e),
          })
        }
      }
    }
  } catch (e: any) {
    logger?.warn?.(
      `[inventory-order] could not signal partner workflow for ${orderId} (${source}): ${e?.message ?? e}`
    )
  }

  const signalled = outcomes.filter((o) => o.ok)
  if (signalled.length) {
    logger?.info?.(
      `[inventory-order] ${source} signalled ${signalled
        .map((o) => `${o.step_id}@${o.transaction_id}`)
        .join(", ")} for ${orderId}`
    )
  }

  return { transaction_ids: transactionIds, outcomes }
}
