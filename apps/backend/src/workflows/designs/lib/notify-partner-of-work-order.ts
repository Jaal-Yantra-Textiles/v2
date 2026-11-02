import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"
import { sendPartnerText, type PartnerTextOutcome } from "../../whatsapp/send-partner-text"
import { composeWorkOrderMessage, type WorkOrderMessageLine } from "./work-order-whatsapp-text"

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

  const designIds = [...new Set(runs.map((r) => r.design_id).filter(Boolean))]
  const { data: designs } = designIds.length
    ? await query.graph({ entity: "design", fields: ["id", "name"], filters: { id: designIds } })
    : { data: [] }
  const nameById = new Map<string, string>(
    (designs ?? []).map((d: any) => [String(d.id), String(d.name || "").trim()])
  )

  // In the order the runs were created, which is the order they were picked.
  const lines: WorkOrderMessageLine[] = [...runs]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    .map((r) => ({
      design_name: nameById.get(String(r.design_id)) || "Design",
      quantity: Number(r.quantity) || 1,
    }))

  // The number the partner sees on the order in the app.
  let orderRef = String(input.work_order_id).slice(-6).toUpperCase()
  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "display_id"],
      filters: { id: input.work_order_id },
    })
    if (orders?.[0]?.display_id) {
      orderRef = String(orders[0].display_id)
    }
  } catch {
    // The short id is a fine reference; the number is a nicety.
  }

  return sendPartnerText(container, {
    partner_id: input.partner_id,
    context_type: WORK_ORDER_SENT_CONTEXT_TYPE,
    context_id: workOrderSentContextId(input.work_order_id, runIds),
    compose: ({ greet_name, language }) =>
      composeWorkOrderMessage({ greet_name, order_ref: orderRef, lines, language }),
  })
}
