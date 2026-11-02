import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { runIdsOnWorkOrder, workOrderIdForRun } from "../../../lib/work-orders/read-work-orders"
import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"

/**
 * #2500 — "is this run one design of a bundle?", for the daily reminders.
 *
 * A bundle is a work order holding two or more live runs for the SAME partner.
 * Shramdaan's #152 holds 9; a one-design order, or a customer order whose runs
 * went to different partners, is not a bundle for that partner, and its runs
 * keep their own reminders.
 */

export type PartnerReminderKind = "assignment_pending" | "not_started" | "idle"

const ONE_DAY = 24 * 60 * 60 * 1000
const THREE_DAYS = 3 * ONE_DAY

/** Statuses a partner can still act on. */
const LIVE = new Set(["sent_to_partner", "in_progress", "approved"])

const ageMs = (iso: any, now: number): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? now - t : null
}

/**
 * PURE — which partner reminder a run is due, if any.
 *
 * ⚠️ The SAME rules as the classify node of the scheduled reminder flow
 * (`scripts/seed-production-run-reminders-flow.ts`, stored in the DB as code).
 * That node decides which runs get a reminder; this decides which of a
 * bundle's designs the one bundle message lists. Change both together.
 */
export function classifyPartnerReminderKind(
  run: { status?: string | null; created_at?: any; accepted_at?: any; started_at?: any },
  now: number = Date.now()
): PartnerReminderKind | null {
  const createdAge = ageMs(run.created_at, now)
  const acceptedAge = ageMs(run.accepted_at, now)
  const startedAge = ageMs(run.started_at, now)
  if (run.status === "sent_to_partner" && !run.accepted_at && createdAge !== null && createdAge >= ONE_DAY) {
    return "assignment_pending"
  }
  if (run.accepted_at && !run.started_at && acceptedAge !== null && acceptedAge >= ONE_DAY) {
    return "not_started"
  }
  if (run.status === "in_progress" && startedAge !== null && startedAge >= THREE_DAYS) {
    return "idle"
  }
  return null
}

export type BundleRun = {
  id: string
  design_id: string | null
  partner_id: string | null
  status: string | null
  quantity: number | null
  created_at: any
  accepted_at: any
  started_at: any
  metadata: Record<string, any> | null
}

const RUN_FIELDS = [
  "id",
  "design_id",
  "partner_id",
  "status",
  "quantity",
  "created_at",
  "accepted_at",
  "started_at",
  "metadata",
]

/**
 * The bundle a run sits in for its partner: its work order and the partner's
 * live runs on it. Null when the run is on no work order or is the partner's
 * only live run there.
 */
export async function findRunBundle(
  container: any,
  runId: string,
  partnerId: string
): Promise<{ work_order_id: string; runs: BundleRun[] } | null> {
  if (!runId || !partnerId) return null
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  // The run's work order: `work_order`'s own link first, the mirror's after,
  // as the partner run route reads it (#2264 S2c).
  let workOrderId = await workOrderIdForRun(container, runId).catch(() => null)
  if (!workOrderId) {
    const { data } = await query.graph({
      entity: "production_runs",
      fields: ["id", "order.id"],
      filters: { id: runId },
    })
    const o = data?.[0]?.order
    workOrderId = (Array.isArray(o) ? o[0]?.id : o?.id) ?? null
  }
  if (!workOrderId) return null

  let runIds = await runIdsOnWorkOrder(container, workOrderId).catch(() => null)
  if (!runIds?.length) {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "production_runs.id"],
      filters: { id: workOrderId },
    })
    runIds = ((data?.[0]?.production_runs ?? []) as any[]).map((r) => r?.id).filter(Boolean)
  }
  if (!runIds?.length) return null

  const runService = container.resolve(PRODUCTION_RUNS_MODULE) as ProductionRunService
  const runs = (await runService.listProductionRuns(
    { id: runIds } as any,
    { select: RUN_FIELDS }
  )) as BundleRun[]

  const mine = runs.filter((r) => r.partner_id === partnerId && LIVE.has(String(r.status)))
  if (mine.length < 2 || !mine.some((r) => r.id === runId)) {
    return null
  }
  return { work_order_id: workOrderId, runs: mine }
}
