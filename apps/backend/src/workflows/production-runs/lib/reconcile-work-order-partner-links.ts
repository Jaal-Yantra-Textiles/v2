import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { LinkDefinition, MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerOrderLink from "../../../links/partner-order"
import { shadowSyncWorkOrder } from "../../../lib/work-orders/sync-from-mirror"

/**
 * #2265 S3b — who may see a design work order follows its runs.
 *
 * Partner access to a work order is decided by the partner↔order link alone
 * (`listPartnerWorkOrderIds`, `validatePartnerOrderOwnership`). Dispatch ADDS a
 * link for the run's partner; nothing ever took one away. So when a run moved
 * from partner A to B — A declines and it is parked, or an admin reassigns it —
 * A kept listing and opening a work order that was now B's.
 *
 * This keeps a partner's link only while they are still the partner (or the
 * outsourced sub-partner) on at least one run of that work order. It never
 * ADDS a link: dispatch owns that, so a run parked with no partner simply
 * leaves its work order with nobody until it is sent again.
 */
export type WorkOrderPartnerReconcile = {
  order_id: string | null
  dismissed_partner_ids: string[]
}

const orderOfRun = async (container: MedusaContainer, runId: string) => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "production_runs",
    filters: { id: runId },
    fields: ["id", "order.id"],
  })
  return (data?.[0]?.order?.id ?? null) as string | null
}

/** Partners that still hold a run on this work order. */
const partnersOnOrder = async (container: MedusaContainer, orderId: string) => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: [
      "id",
      "production_runs.id",
      "production_runs.partner_id",
      "production_runs.execution_mode",
      "production_runs.sub_partner_id",
    ],
  })
  const runs = data?.[0]?.production_runs
  const list: any[] = Array.isArray(runs) ? runs : runs ? [runs] : []
  const keep = new Set<string>()
  for (const run of list) {
    if (run?.partner_id) keep.add(run.partner_id)
    if (run?.execution_mode === "outsourced" && run?.sub_partner_id) {
      keep.add(run.sub_partner_id)
    }
  }
  return keep
}

const pair = (partnerId: string, orderId: string): LinkDefinition => ({
  [PARTNER_MODULE]: { partner_id: partnerId },
  [Modules.ORDER]: { order_id: orderId },
})

/**
 * Who is linked to a design work order, and which of them hold no run on it
 * any more. Read-only; shared by the reassignment step and the cleanup job.
 */
export const planWorkOrderPartnerLinks = async (
  container: MedusaContainer,
  orderId: string
) => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({
    entity: PartnerOrderLink.entryPoint,
    filters: { order_id: orderId },
    fields: ["partner_id"],
  })
  const linked = [
    ...new Set<string>((links ?? []).map((l: any) => l?.partner_id).filter(Boolean)),
  ]
  const keep = await partnersOnOrder(container, orderId)
  return { linked, stale: linked.filter((id) => !keep.has(id)) }
}

/** Dismisses the given partners' links to the work order and refreshes it. */
export const dismissWorkOrderPartnerLinks = async (
  container: MedusaContainer,
  orderId: string,
  partnerIds: string[]
) => {
  if (!partnerIds.length) return
  const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
  await remoteLink.dismiss(partnerIds.map((p) => pair(p, orderId)))
  // work_order.partner_id is copied from the first link; refresh it now
  // rather than leave it naming the departed partner until the next write.
  await shadowSyncWorkOrder(container, orderId, "reconcile-work-order-partner-links")
}

export const reconcileWorkOrderPartnerLinks = async (
  container: MedusaContainer,
  runId: string
): Promise<WorkOrderPartnerReconcile> => {
  const orderId = await orderOfRun(container, runId)
  if (!orderId) return { order_id: null, dismissed_partner_ids: [] }

  const { stale } = await planWorkOrderPartnerLinks(container, orderId)
  await dismissWorkOrderPartnerLinks(container, orderId, stale)
  return { order_id: orderId, dismissed_partner_ids: stale }
}

/**
 * Run AFTER the run's `partner_id` has changed. Compensation restores the
 * dismissed links, so a rolled-back reassignment leaves access as it was.
 */
export const reconcileWorkOrderPartnerLinksStep = createStep(
  "reconcile-work-order-partner-links",
  async (input: { production_run_id: string }, { container }) => {
    const result = await reconcileWorkOrderPartnerLinks(
      container as any,
      input.production_run_id
    )
    return new StepResponse(result, result)
  },
  async (comp: WorkOrderPartnerReconcile | undefined, { container }) => {
    if (!comp?.order_id || !comp.dismissed_partner_ids.length) return
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.create(
      comp.dismissed_partner_ids.map((p) => pair(p, comp.order_id!))
    )
    await shadowSyncWorkOrder(container, comp.order_id, "reconcile-work-order-partner-links:compensate")
  }
)
