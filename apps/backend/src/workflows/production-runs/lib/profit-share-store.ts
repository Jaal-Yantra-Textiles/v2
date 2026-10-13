import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"
import { computeProfitShare } from "./profit-share"
import {
  deductSaleFromBankedStock,
  restoreSaleToBankedStock,
} from "./profit-share-stock"

/**
 * #2322 — reads and writes for a run's profit share, shared by the admin and
 * partner routes so both sides see the same rows and the same arithmetic.
 */

export const SetProfitShareSchema = z.object({
  /** 0-100, or null to remove the arrangement. */
  percent: z.number().min(0).max(100).nullable(),
})

export const RecordSaleSchema = z.object({
  quantity: z.number().positive(),
  unit_price: z.number().positive(),
  currency_code: z.string().length(3).optional(),
  sold_at: z.string().datetime({ offset: true }).optional(),
  note: z.string().max(1000).optional(),
})

export const RecordSettlementSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["bank_transfer", "cash"]),
  currency_code: z.string().length(3).optional(),
  paid_at: z.string().datetime({ offset: true }).optional(),
  reference: z.string().max(500).optional(),
  receipt_url: z.string().url().optional(),
  note: z.string().max(1000).optional(),
})

export const parseOrThrow = <T extends z.ZodTypeAny>(
  schema: T,
  body: unknown
): z.infer<T> => {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join(", ")
    )
  }
  return parsed.data
}

const serviceOf = (scope: any): ProductionRunService =>
  scope.resolve(PRODUCTION_RUNS_MODULE)

export async function retrieveRunOrThrow(
  scope: any,
  runId: string,
  partnerId?: string
) {
  const run = await serviceOf(scope)
    .retrieveProductionRun(runId)
    .catch(() => null)
  // A partner asking about another partner's run gets the same 404 as a
  // missing run — it does not learn the run exists.
  if (!run || (partnerId && (run as any).partner_id !== partnerId)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${runId} not found`
    )
  }
  return run as any
}

const RUN_CURRENCY = (run: any) =>
  String(run?.cost_currency || "inr").toLowerCase()

export async function loadProfitShare(scope: any, run: any) {
  const service = serviceOf(scope)
  const [sales, settlements] = await Promise.all([
    service.listProductionRunSales(
      { production_run_id: run.id } as any,
      { order: { sold_at: "ASC" } } as any
    ),
    service.listProductionRunSettlements(
      { production_run_id: run.id } as any,
      { order: { paid_at: "ASC" } } as any
    ),
  ])

  const summary = computeProfitShare({
    percent: run.profit_share_percent ?? null,
    run_quantity:
      typeof run.produced_quantity === "number"
        ? run.produced_quantity
        : typeof run.quantity === "number"
          ? run.quantity
          : null,
    sales: sales.map((s: any) => ({
      quantity: Number(s.quantity),
      unit_price: Number(s.unit_price),
      currency_code: s.currency_code,
    })),
    settlements: settlements.map((s: any) => ({
      amount: Number(s.amount),
      currency_code: s.currency_code,
    })),
    default_currency: RUN_CURRENCY(run),
  })

  return {
    production_run_id: run.id,
    partner_id: run.partner_id ?? null,
    percent: run.profit_share_percent ?? null,
    sales,
    settlements,
    summary,
  }
}

export async function setProfitSharePercent(
  scope: any,
  run: any,
  percent: number | null
) {
  await serviceOf(scope).updateProductionRuns({
    id: run.id,
    profit_share_percent: percent,
  } as any)
  return { ...run, profit_share_percent: percent }
}

export async function recordSale(
  scope: any,
  run: any,
  body: z.infer<typeof RecordSaleSchema>,
  actor: { type: "admin" | "partner"; id: string | null }
) {
  if (run.profit_share_percent === null || run.profit_share_percent === undefined) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This run has no profit-share arrangement — set the percent first."
    )
  }
  const current = await loadProfitShare(scope, run)
  const cap = current.summary.run_quantity
  if (cap !== null && current.summary.sold_quantity + body.quantity > cap) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Selling ${body.quantity} would report ${current.summary.sold_quantity + body.quantity} sold, more than the run's ${cap} pieces.`
    )
  }
  const sale: any = await serviceOf(scope).createProductionRunSales({
    production_run_id: run.id,
    partner_id: run.partner_id ?? null,
    quantity: body.quantity,
    unit_price: body.unit_price,
    currency_code: (body.currency_code ?? RUN_CURRENCY(run)).toLowerCase(),
    sold_at: body.sold_at ? new Date(body.sold_at) : new Date(),
    note: body.note ?? null,
    reported_by: actor.type,
    actor_id: actor.id,
  } as any)

  // #2401 — sold after the close: those pieces are no longer in the warehouse
  // the close banked them into. Recorded on the sale so a delete undoes it.
  const stock_effect = await deductSaleFromBankedStock(scope, run, body.quantity)
  if (stock_effect.deducted > 0 || (run.stocked_at && "reason" in stock_effect)) {
    await serviceOf(scope).updateProductionRunSales({
      id: sale.id,
      metadata: { ...(sale.metadata ?? {}), stock_effect },
    } as any)
    sale.metadata = { ...(sale.metadata ?? {}), stock_effect }
  }
  return sale
}

export async function recordSettlement(
  scope: any,
  run: any,
  body: z.infer<typeof RecordSettlementSchema>,
  actorId: string | null
) {
  if (run.profit_share_percent === null || run.profit_share_percent === undefined) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This run has no profit-share arrangement — set the percent first."
    )
  }
  return serviceOf(scope).createProductionRunSettlements({
    production_run_id: run.id,
    partner_id: run.partner_id ?? null,
    amount: body.amount,
    currency_code: (body.currency_code ?? RUN_CURRENCY(run)).toLowerCase(),
    method: body.method,
    paid_at: body.paid_at ? new Date(body.paid_at) : new Date(),
    reference: body.reference ?? null,
    receipt_url: body.receipt_url ?? null,
    note: body.note ?? null,
    actor_id: actorId,
  } as any)
}

export async function deleteRunRow(
  scope: any,
  run: any,
  kind: "sale" | "settlement",
  rowId: string
) {
  const service = serviceOf(scope)
  const rows =
    kind === "sale"
      ? await service.listProductionRunSales({ id: rowId, production_run_id: run.id } as any)
      : await service.listProductionRunSettlements({ id: rowId, production_run_id: run.id } as any)
  if (!rows.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `${kind} ${rowId} not found on this run`)
  }
  if (kind === "sale") {
    await service.softDeleteProductionRunSales([rowId])
    await restoreSaleToBankedStock(scope, rows[0])
  }
  else await service.softDeleteProductionRunSettlements([rowId])
}
