import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import { projectDispatchedCustomerOrderRun } from "../../../../workflows/production-runs/dual-write-unified-run-order"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Give already-dispatched customer-order runs their work-order (#2281).
 *
 * The live case: order #101's four Oshen runs went to Ksaman on 2026-09-25 and
 * landed on no work-order, so Ksaman's portal listed nothing. The dispatch hook
 * now covers new dispatches; this repairs the ones before it, through the SAME
 * function, one run at a time — the first run per partner gets an order, each
 * sibling joins it.
 *
 * 🔴 Named orders only, never a sweep. A run is picked only when it has a
 * partner AND evidence it was dispatched: `sent_to_partner` / `in_progress`,
 * or `completed` with an accept/start/dispatch stamp. A retail run closed by
 * fulfilment from stock was never partner work (#1126) and is left alone.
 *
 * Preview (dry_run, the default) writes nothing.
 */

const DISPATCHED = ["sent_to_partner", "in_progress"]

export const isDispatchedPartnerRun = (run: any): boolean => {
  if (!run?.partner_id) return false
  if (DISPATCHED.includes(run.status)) return true
  if (run.status !== "completed") return false
  return Boolean(
    run.accepted_at ||
      run.started_at ||
      (Array.isArray(run.dispatched_template_ids) && run.dispatched_template_ids.length)
  )
}

const parseIds = (raw: unknown): string[] =>
  Array.from(
    new Set(
      String(raw ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  )

export const collateCustomerOrderRunsJob: MaintenanceJob = {
  id: "collate-customer-order-runs",
  label: "Give dispatched customer-order runs their work-order",
  description:
    "For the named customer orders, puts every run that was dispatched to a partner but sits on no work-order onto one work-order per (customer order, partner) — joining a sibling run's open work-order when there is one. This is what dispatch now does on its own (#2281); use it for runs dispatched before that. Runs with no partner, or never dispatched, are left alone. Preview (dry run) writes nothing.",
  params: [
    {
      name: "order_ids",
      type: "string",
      required: true,
      description: "Customer order ids (order_...), comma-separated",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const orderIds = parseIds(params.order_ids)
    if (!orderIds.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "order_ids is required")
    }
    const service: any = container.resolve(PRODUCTION_RUNS_MODULE)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const runs: any[] = await service.listProductionRuns(
      { order_id: orderIds } as any,
      { select: ["*"], order: { created_at: "ASC" } }
    )
    const { data: linked } = runs.length
      ? await query.graph({
          entity: "production_runs",
          fields: ["id", "order.id", "order.status"],
          filters: { id: runs.map((r) => r.id) },
        })
      : { data: [] }
    const orderOf = new Map<string, { id: string; status: string }>()
    for (const r of linked || []) {
      if (r?.order?.id) orderOf.set(String(r.id), { id: r.order.id, status: String(r.order.status ?? "") })
    }

    const todo = runs.filter((r) => isDispatchedPartnerRun(r) && !orderOf.has(String(r.id)))

    // Plan per (customer order, partner): join a sibling's open order, else the
    // first run mints one and the rest join it.
    const changes: MaintenanceChange[] = []
    const planned = new Map<string, string>()
    for (const run of todo) {
      const key = `${run.order_id}|${run.partner_id}`
      if (!planned.has(key)) {
        const open = runs.find((s) => {
          const o = orderOf.get(String(s.id))
          return (
            s.order_id === run.order_id &&
            s.partner_id === run.partner_id &&
            o &&
            !["completed", "canceled", "cancelled"].includes(o.status)
          )
        })
        planned.set(key, open ? `join ${orderOf.get(String(open.id))!.id}` : "new work-order")
      }
      const plan = planned.get(key)!
      changes.push({
        entity: "production_run",
        id: run.id,
        field: "work_order",
        before: null,
        after: plan,
        reason: `${run.snapshot?.design?.name ?? run.design_id} ×${run.quantity} — ${run.status}, partner ${run.partner_id}, order ${run.order_id}`,
      } as MaintenanceChange)
      if (plan === "new work-order") planned.set(key, "join the order minted above")
    }

    const skipped = runs.length - todo.length
    if (dry_run) {
      return {
        job_id: "collate-customer-order-runs",
        dry_run: true,
        applied: false,
        summary: `${todo.length} dispatched run(s) with no work-order across ${new Set(todo.map((r) => `${r.order_id}|${r.partner_id}`)).size} (order, partner) pair(s); ${skipped} run(s) left alone (no partner, not dispatched, or already on an order).`,
        changes,
      }
    }

    const results: string[] = []
    for (const run of todo) {
      const res = await projectDispatchedCustomerOrderRun(container, run.id)
      results.push(`${run.id} → ${res.unified_order_id ?? `FAILED (${res.error ?? res.skipped})`}`)
    }
    const failed = results.filter((r) => r.includes("FAILED"))
    return {
      job_id: "collate-customer-order-runs",
      dry_run: false,
      applied: todo.length > failed.length,
      summary: `Projected ${todo.length - failed.length}/${todo.length} run(s). ${results.join("; ")}`,
      changes,
    }
  },
}
