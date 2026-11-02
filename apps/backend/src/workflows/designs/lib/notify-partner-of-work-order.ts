import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"
import { sendPartnerText, type PartnerTextOutcome } from "../../whatsapp/send-partner-text"
import { reminderPauseOf } from "../../production-runs/lib/reminder-pause"
import {
  classifyPartnerReminderKind,
  findRunBundle,
  type PartnerReminderKind,
} from "../../production-runs/lib/run-bundle"
import {
  composeWorkOrderMessage,
  composeWorkOrderReminder,
  type WorkOrderMessageLine,
} from "./work-order-whatsapp-text"

/**
 * #2500 — tell a partner about a bundle of designs in ONE WhatsApp.
 *
 * Context is per batch, not per order: a later batch that joins the same open
 * work order (`collate: "partner-open"`) is new work and gets its own message.
 * The lowest run id names the batch, since every batch's runs are new.
 */

export const WORK_ORDER_SENT_CONTEXT_TYPE = "work_order"
export const workOrderSentContextId = (workOrderId: string, runIds: string[]) =>
  `${workOrderId}:sent:${[...runIds].sort()[0]}`

export async function notifyPartnerOfWorkOrder(
  container: MedusaContainer,
  input: { work_order_id: string; partner_id: string; production_run_ids: string[] }
): Promise<PartnerTextOutcome> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const runService = container.resolve(PRODUCTION_RUNS_MODULE) as ProductionRunService

  const runIds = [...new Set((input.production_run_ids || []).filter(Boolean))]
  if (!runIds.length) {
    return { sent: false, reason: "no_runs" }
  }

  const runs: any[] = await runService.listProductionRuns(
    { id: runIds } as any,
    { select: ["id", "design_id", "quantity", "created_at"] }
  )
  if (!runs.length) {
    return { sent: false, reason: "runs_not_found" }
  }

  const nameById = await designNames(query, runs)

  // In the order the runs were created, which is the order they were picked.
  const lines: WorkOrderMessageLine[] = [...runs]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    .map((r) => ({
      design_name: nameById.get(String(r.design_id)) || "Design",
      quantity: Number(r.quantity) || 1,
    }))

  const orderRef = await orderRefOf(query, input.work_order_id)

  return sendPartnerText(container, {
    partner_id: input.partner_id,
    context_type: WORK_ORDER_SENT_CONTEXT_TYPE,
    context_id: workOrderSentContextId(input.work_order_id, runIds),
    compose: ({ greet_name, language }) =>
      composeWorkOrderMessage({ greet_name, order_ref: orderRef, lines, language }),
  })
}

const designNames = async (query: any, runs: any[]): Promise<Map<string, string>> => {
  const designIds = [...new Set(runs.map((r) => r.design_id).filter(Boolean))]
  const { data: designs } = designIds.length
    ? await query.graph({ entity: "design", fields: ["id", "name"], filters: { id: designIds } })
    : { data: [] }
  return new Map<string, string>(
    (designs ?? []).map((d: any) => [String(d.id), String(d.name || "").trim()])
  )
}

/** The number the partner sees on the order in the app. */
const orderRefOf = async (query: any, workOrderId: string): Promise<string> => {
  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "display_id"],
      filters: { id: workOrderId },
    })
    if (orders?.[0]?.display_id) {
      return String(orders[0].display_id)
    }
  } catch {
    // The short id is a fine reference; the number is a nicety.
  }
  return String(workOrderId).slice(-6).toUpperCase()
}

/** One bundle reminder per (work order, kind, day). */
export const workOrderReminderContextId = (
  workOrderId: string,
  kind: PartnerReminderKind,
  day: string
) => `${workOrderId}:reminder:${kind}:${day}`

const SINCE_FIELD: Record<PartnerReminderKind, "created_at" | "accepted_at" | "started_at"> = {
  assignment_pending: "created_at",
  not_started: "accepted_at",
  idle: "started_at",
}

export type BundleReminderOutcome =
  | (PartnerTextOutcome & { work_order_id: string; listed: number })
  | { sent: false; reason: "not_in_bundle" }

/**
 * #2500 — ONE daily reminder for a bundle, instead of one per design.
 *
 * Triggered by each bundled run's reminder; the first one of the day sends,
 * the rest find the day's message already sent. It lists every design of the
 * bundle due the SAME reminder today, so the message does not depend on which
 * run's reminder fired first.
 */
export async function remindPartnerOfWorkOrder(
  container: MedusaContainer,
  input: {
    production_run_id: string
    partner_id: string
    reminder_kind: PartnerReminderKind
    now?: Date
  }
): Promise<BundleReminderOutcome> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const now = input.now ?? new Date()

  const bundle = await findRunBundle(container, input.production_run_id, input.partner_id)
  if (!bundle) {
    return { sent: false, reason: "not_in_bundle" }
  }

  const due = bundle.runs
    .filter(
      (r) =>
        r.id === input.production_run_id ||
        (classifyPartnerReminderKind(r, now.getTime()) === input.reminder_kind && !reminderPauseOf(r))
    )
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id))

  const nameById = await designNames(query, due)
  const since = SINCE_FIELD[input.reminder_kind]
  const lines = due.map((r) => {
    const at = (r as any)[since] ? new Date((r as any)[since]).getTime() : now.getTime()
    return {
      design_name: nameById.get(String(r.design_id)) || "Design",
      quantity: Number(r.quantity) || 1,
      days: Math.max(1, Math.floor((now.getTime() - at) / 86_400_000)),
    }
  })
  const orderRef = await orderRefOf(query, bundle.work_order_id)

  const outcome = await sendPartnerText(container, {
    partner_id: input.partner_id,
    context_type: WORK_ORDER_SENT_CONTEXT_TYPE,
    context_id: workOrderReminderContextId(
      bundle.work_order_id,
      input.reminder_kind,
      now.toISOString().slice(0, 10)
    ),
    compose: ({ greet_name, language }) =>
      composeWorkOrderReminder({
        greet_name,
        order_ref: orderRef,
        kind: input.reminder_kind,
        lines,
        language,
      }),
  })
  return { ...outcome, work_order_id: bundle.work_order_id, listed: lines.length }
}
