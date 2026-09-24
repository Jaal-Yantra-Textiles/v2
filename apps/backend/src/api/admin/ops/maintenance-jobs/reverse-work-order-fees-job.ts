import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PARTNER_BILLING_MODULE } from "../../../../modules/partner_billing"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #2262, founder decision A (2026-09-24): a WORK order carries no commission.
 *
 * A work order is a purchase FROM the partner — a production run or an
 * inventory order mirrored into the core order (#342). The retired
 * `backfill-partner-order-fees` job read every order on the partner↔order link
 * (which only that mirror writes) and accrued the flat 2% commission on each:
 * 44 rows on prod (2026-07-03 + 07-11), ₹2,229.98 + €258.52 non-zero. None was
 * ever deducted — nothing reads partner_fee for payouts — but the fees page and
 * the platform / investor stats panels count `accrued` rows as revenue.
 *
 * This job flips those rows `accrued` → `reversed`. Selection is strict:
 *   - `fee_type = commission` AND `status = accrued` (a retail_split fee, or a
 *     fee already invoiced / waived / reversed, is never touched), AND
 *   - the fee's order has an order↔production_run or order↔inventory_order
 *     link — PROOF it is a work order, not an inference from the partner link.
 * A commission fee whose order has neither is reported and left alone.
 */

const MAX_SCAN = 5000

const paramsSchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_SCAN).optional().default(1000),
})

export const WORK_ORDER_FEE_REVERSAL_REASON = "work_order_no_commission"

type FeeRow = {
  id: string
  order_id: string
  partner_id: string
  fee_type?: string | null
  status?: string | null
  fee_amount?: unknown
  currency_code?: string | null
}

/**
 * Pure: split accrued commission fees into the ones on a PROVEN work order
 * (reverse) and the rest (report, never touch). Exported for unit testing.
 */
export const selectWorkOrderFees = (
  fees: FeeRow[],
  workOrderIds: ReadonlySet<string>
): { reverse: FeeRow[]; notWorkOrder: FeeRow[] } => {
  const eligible = fees.filter(
    (f) => f.fee_type === "commission" && f.status === "accrued"
  )
  return {
    reverse: eligible.filter((f) => workOrderIds.has(f.order_id)),
    notWorkOrder: eligible.filter((f) => !workOrderIds.has(f.order_id)),
  }
}

const hasLink = (rel: any): boolean =>
  Array.isArray(rel) ? rel.some((r) => r?.id) : Boolean(rel?.id)

export const reverseWorkOrderFeesJob: MaintenanceJob = {
  id: "reverse-work-order-fees",
  label: "Reverse commission fees on work orders",
  description:
    `Founder decision A (#2262, 2026-09-24): work orders carry no commission. Flips every accrued 'commission' partner_fee whose order is a PROVEN work order (it has an order↔production_run or order↔inventory_order link) to 'reversed', with reversed_reason='${WORK_ORDER_FEE_REVERSAL_REASON}'. Retail-split fees, and fees already invoiced / waived / reversed, are never touched. A commission fee on an order with neither link is reported, not reversed. Dry-run previews; apply writes. Bounded by limit (default 1000, max ${MAX_SCAN}).`,
  params: [
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max fees to reverse in one call (default 1000, max ${MAX_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const { limit } = paramsSchema.parse(params)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const billing: any = container.resolve(PARTNER_BILLING_MODULE)

    const fees: FeeRow[] = await billing.listPartnerFees(
      { fee_type: "commission", status: "accrued" },
      { take: MAX_SCAN }
    )

    const orderIds = Array.from(new Set(fees.map((f) => f.order_id).filter(Boolean)))
    const workOrderIds = new Set<string>()
    if (orderIds.length) {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "production_runs.id", "inventory_orders.id"],
        filters: { id: orderIds },
      })
      for (const o of orders ?? []) {
        if (hasLink(o?.production_runs) || hasLink(o?.inventory_orders)) {
          workOrderIds.add(o.id)
        }
      }
    }

    const { reverse, notWorkOrder } = selectWorkOrderFees(fees, workOrderIds)
    const batch = reverse.slice(0, limit)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    let failed = 0
    for (const fee of batch) {
      changes.push({
        entity: "partner_fee",
        id: fee.id,
        field: "status",
        before: "accrued",
        after: "reversed",
        note: `commission ${Number(fee.fee_amount)} ${fee.currency_code} on work order ${fee.order_id} (partner ${fee.partner_id})`,
      })
      if (dry_run) continue
      try {
        await billing.reverseFeeForOrder(fee.order_id, WORK_ORDER_FEE_REVERSAL_REASON)
      } catch (e: any) {
        failed++
        errors.push({ id: fee.id, message: e?.message ?? String(e) })
      }
    }

    for (const fee of notWorkOrder) {
      errors.push({
        id: fee.id,
        message: `left alone: order ${fee.order_id} has no production-run or inventory-order link, so it is not a proven work order`,
      })
    }

    const verb = dry_run ? "Would reverse" : "Reversed"
    return {
      job_id: reverseWorkOrderFeesJob.id,
      dry_run,
      applied: !dry_run && batch.length - failed > 0,
      summary:
        `${verb} ${changes.length} work-order commission fee(s) of ${fees.length} accrued commission fee(s) scanned` +
        (notWorkOrder.length ? `; ${notWorkOrder.length} left alone (not a proven work order)` : "") +
        (reverse.length > batch.length ? `; ${reverse.length - batch.length} more beyond limit` : ""),
      changes,
      errors,
    }
  },
}
