import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import type { Link } from "@medusajs/modules-sdk"

import { ORDER_INVENTORY_MODULE } from "../../../../modules/inventory_orders"
import { PARTNER_MODULE } from "../../../../modules/partner"
import {
  areGoodsFinished,
  assessInventoryOrderFinished,
  loadInventoryOrderFinishEvidence,
} from "../../../../workflows/inventory_orders/lib/order-finished"
import {
  SEND_TO_PARTNER_WORKFLOW_ID,
  signalPartnerWorkflowFinished,
} from "../../../../workflows/inventory_orders/lib/signal-partner-workflow"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

export const JOB_ID = "relink-rolled-back-inventory-order-partners"

const idList = z
  .string()
  .optional()
  .transform((v) =>
    Array.from(
      new Set(
        (v ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )
  )

const paramsSchema = z.object({
  order_ids: idList,
  signal_in_flight: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true"),
})

export type RolledBackRow = {
  inventory_order_id: string
  partner_id: string | null
  occurred_at: string | Date
}

/**
 * Latest `workflow_rollback` row per order. A rollback whose reason is anything
 * else is a deliberate un-assignment and is never undone here.
 */
export function latestWorkflowRollbacks(
  activities: Array<{
    inventory_order_id: string
    partner_id?: string | null
    payload?: Record<string, any> | null
    occurred_at: string | Date
  }>
): RolledBackRow[] {
  const byOrder = new Map<string, RolledBackRow>()
  for (const a of activities) {
    if (a?.payload?.reason !== "workflow_rollback") continue
    const prev = byOrder.get(a.inventory_order_id)
    if (!prev || new Date(a.occurred_at).getTime() > new Date(prev.occurred_at).getTime()) {
      byOrder.set(a.inventory_order_id, {
        inventory_order_id: a.inventory_order_id,
        partner_id: a.partner_id ?? null,
        occurred_at: a.occurred_at,
      })
    }
  }
  return Array.from(byOrder.values())
}

/**
 * #2324 — put back the partner link a timed-out send-to-partner workflow took
 * away from an order that was already finished.
 *
 * The workflow's await steps time out after 23 days; when admin receive or the
 * close-received job finished the order, nobody signalled them, and the
 * compensation dismissed the order↔partner link (`partner_link_rolled_back`,
 * reason `workflow_rollback`). The compensation is now guarded; this job repairs
 * the orders it already hit.
 *
 * 🔴 It NEVER calls assign-partner or send-to-partner. Both start a new workflow
 * and send-to-partner messages the partner — and a message cannot be recalled.
 * The link is written directly, and the timeline row is written directly (no
 * event, so no subscriber can turn it into a message).
 *
 * Re-links only when ALL hold:
 *  - the order's latest rollback has reason `workflow_rollback`;
 *  - the order is finished by real evidence (`assessInventoryOrderFinished`):
 *    Delivered, stock received, closed-as-received, or a paid payout;
 *  - the order has no partner now (one linked to someone else is left alone);
 *  - the rolled-back partner still exists.
 *
 * It also AUDITS in-flight send-to-partner transactions whose order is already
 * finished — the ones that will time out and hit the (now guarded) rollback.
 * With `signal_in_flight=true` it signals them so they finish cleanly; that
 * sends nothing to anyone.
 *
 * Dry-run (preview) writes nothing.
 */
export const relinkRolledBackInventoryOrderPartnersJob: MaintenanceJob = {
  id: JOB_ID,
  label: "Re-link partners a timed-out send-to-partner workflow un-linked from finished inventory orders (#2324)",
  description:
    "Restore the inventory order↔partner link that the send-to-partner workflow's 23-day timeout rolled back (activity partner_link_rolled_back, reason workflow_rollback) on orders that were already finished — Delivered, stock received, closed as received, or a paid payout. Writes the link directly and a partner_link_restored timeline row; NEVER calls assign/send-to-partner, so the partner gets no message and no new workflow starts. Skips orders that are not finished, that are linked to a partner now, or whose partner no longer exists. Also audits in-flight send-to-partner transactions whose order is already finished; with signal_in_flight=true it signals their await steps so they complete instead of timing out (no message is sent). Dry-run previews and writes nothing.",
  params: [
    {
      name: "order_ids",
      type: "string",
      required: false,
      description: "Comma-separated inventory order ids to limit the repair to (default: every workflow_rollback)",
    },
    {
      name: "signal_in_flight",
      type: "boolean",
      required: false,
      description: "Also signal in-flight send-to-partner transactions whose order is finished (apply only)",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { order_ids, signal_in_flight } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const inventoryOrders: any = container.resolve(ORDER_INVENTORY_MODULE)
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let relinked = 0

    // ── 1. Re-link finished orders the rollback un-linked ────────────────────
    const activities = await inventoryOrders.listInventoryOrderActivities(
      {
        kind: "partner_link_rolled_back",
        ...(order_ids.length ? { inventory_order_id: order_ids } : {}),
      },
      { take: 10000, order: { occurred_at: "DESC" } }
    )
    const rollbacks = latestWorkflowRollbacks(activities ?? [])

    const candidateIds = rollbacks.map((r) => r.inventory_order_id)
    const linkedBy = new Map<string, string | null>()
    if (candidateIds.length) {
      const { data: orders } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "partner.id"],
        filters: { id: candidateIds },
      })
      for (const o of (orders ?? []) as any[]) {
        const p = Array.isArray(o.partner) ? o.partner[0] : o.partner
        linkedBy.set(String(o.id), p?.id ?? null)
      }
    }

    for (const rb of rollbacks) {
      const id = rb.inventory_order_id
      if (!linkedBy.has(id)) {
        errors.push({ id, message: "inventory order not found" })
        continue
      }
      if (!rb.partner_id) {
        errors.push({ id, message: "rollback row names no partner — cannot tell whom to re-link" })
        continue
      }
      const current = linkedBy.get(id)
      if (current === rb.partner_id) {
        continue // already linked (re-run, or re-sent since) — nothing to do
      }
      if (current) {
        errors.push({ id, message: `now linked to partner ${current} — left alone` })
        continue
      }

      const evidence = await loadInventoryOrderFinishEvidence(container, id)
      const verdict = evidence
        ? assessInventoryOrderFinished(evidence)
        : { finished: false, reasons: [] as string[] }
      if (!verdict.finished) {
        errors.push({
          id,
          message: `not finished (status ${evidence?.status ?? "unknown"}, no stock received, no paid payout) — the rollback stands`,
        })
        continue
      }

      const { data: partners } = await query.graph({
        entity: "partners",
        fields: ["id"],
        filters: { id: rb.partner_id },
      })
      if (!partners?.length) {
        errors.push({ id, message: `partner ${rb.partner_id} no longer exists` })
        continue
      }

      const change: MaintenanceChange = {
        entity: "inventory_order",
        id,
        field: "partner",
        before: null,
        after: rb.partner_id,
        note: `un-linked by workflow_rollback at ${new Date(rb.occurred_at).toISOString()}; finished: ${verdict.reasons.join("; ")} · link only, no message, no workflow`,
      }

      if (dry_run) {
        changes.push(change)
        continue
      }

      await remoteLink.create([
        {
          [PARTNER_MODULE]: { partner_id: rb.partner_id },
          [ORDER_INVENTORY_MODULE]: { inventory_orders_id: id },
        },
      ])
      await inventoryOrders.createInventoryOrderActivities({
        inventory_order_id: id,
        activity_type: "lifecycle_event",
        kind: "partner_link_restored",
        actor_type: "admin",
        actor_id: null,
        partner_id: rb.partner_id,
        channel: null,
        message_id: null,
        template_name: null,
        recipient: null,
        summary: "Partner assignment restored (#2324): the workflow timeout had un-linked a finished order. No message sent.",
        payload: { job: JOB_ID, reasons: verdict.reasons },
        occurred_at: new Date(),
      })
      relinked++
      changes.push(change)
    }

    // ── 2. Audit in-flight transactions whose order is already finished ──────
    let inFlight: Array<{ transaction_id: string; order_id: string | null }> = []
    try {
      const res = await pg.raw(
        `select transaction_id,
                context->'data'->'payload'->>'inventoryOrderId' as order_id
           from workflow_execution
          where workflow_id = ?
            and state = 'invoking'
            and deleted_at is null`,
        [SEND_TO_PARTNER_WORKFLOW_ID]
      )
      inFlight = (res?.rows ?? []) as any[]
    } catch (e: any) {
      errors.push({ id: "workflow_execution", message: `could not read in-flight transactions: ${e?.message ?? e}` })
    }

    let finishedInFlight = 0
    let signalledInFlight = 0
    for (const t of inFlight) {
      if (!t.order_id) continue
      if (order_ids.length && !order_ids.includes(t.order_id)) continue
      const evidence = await loadInventoryOrderFinishEvidence(container, t.order_id)
      if (!evidence) continue
      const verdict = assessInventoryOrderFinished(evidence)
      if (!verdict.finished) continue
      // Only GOODS evidence may end a partner's workflow. A paid payout alone
      // (a 100%-advance order still in transit) is not finished — signalling it
      // would close the partner's tracking before anything shipped.
      if (!areGoodsFinished(evidence)) {
        changes.push({
          entity: "workflow_transaction",
          id: t.transaction_id,
          field: "audit",
          before: t.order_id,
          note: `in-flight send-to-partner, NOT signalled: paid but goods not finished (${verdict.reasons.join("; ")})`,
        })
        continue
      }
      finishedInFlight++

      let note = `in-flight send-to-partner on a finished order (${verdict.reasons.join("; ")}) — will time out unless signalled`
      if (!dry_run && signal_in_flight) {
        const result = await signalPartnerWorkflowFinished(container, t.order_id, JOB_ID)
        const ok = result.outcomes.filter((o) => o.ok && o.transaction_id === t.transaction_id)
        if (ok.length) {
          signalledInFlight++
          note = `signalled ${ok.map((o) => o.step_id).join(", ")} on a finished order (${verdict.reasons.join("; ")})`
        } else {
          note = `${note}; signal failed: ${result.outcomes
            .filter((o) => o.transaction_id === t.transaction_id)
            .map((o) => `${o.step_id}: ${o.error}`)
            .join("; ")}`
        }
      }
      changes.push({
        entity: "workflow_transaction",
        id: t.transaction_id,
        field: "audit",
        before: t.order_id,
        note,
      })
    }

    const verb = dry_run ? "Would re-link" : "Re-linked"
    return {
      job_id: JOB_ID,
      dry_run,
      applied: !dry_run && (relinked > 0 || signalledInFlight > 0),
      summary: `${verb} ${dry_run ? changes.filter((c) => c.entity === "inventory_order").length : relinked} finished order(s) to the partner a workflow rollback removed (no message sent); ${errors.length} skipped. In-flight send-to-partner transactions on finished orders: ${finishedInFlight}${
        signal_in_flight && !dry_run ? `, signalled ${signalledInFlight}` : ""
      }.`,
      changes,
      errors,
    }
  },
}
