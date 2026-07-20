import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PARTNER_BILLING_MODULE } from "../../../../modules/partner_billing"
import { computeRetailSplitFee } from "../../../../modules/partner_billing/compute-fee"
import { resolveRetailFeeRates } from "../../../../modules/partner_billing/resolve-fee-rate"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

const MAX_RETAIL_FEE_BACKFILL_SCAN = 5000

const paramsSchema = z.object({
  order_ids: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : String(v ?? "").split(","))
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_RETAIL_FEE_BACKFILL_SCAN)
    .optional()
    .default(1000),
})

/**
 * Retail counterpart to `backfill-partner-order-fees`.
 *
 * Retail (storefront) orders have no partner↔order work-order link — their
 * partner owns the sales channel's store. This job builds a
 * sales_channel → partner map (partners/stores are few), then accrues the
 * retail split fee (2% payment gateway + 15% commission) for retail orders that
 * don't already have a `partner_fee`. Provide `order_ids` to target specific
 * orders (e.g. a single #79), or omit to scan up to `limit` orders.
 *
 * Idempotent: orders with an existing fee are skipped; canceled orders are
 * skipped (would net to zero). Dry-run previews; apply writes.
 */
export const backfillRetailPartnerFeesJob: MaintenanceJob = {
  id: "backfill-retail-partner-fees",
  label: "Backfill retail partner fees",
  description:
    `Accrue the retail partner fee (2% payment gateway + 15% commission, PLATFORM_GATEWAY_FEE_BPS / PLATFORM_COMMISSION_FEE_BPS) for retail (storefront) partner orders that predate the retail branch of the order.placed fee subscriber. Resolves each order's partner via sales_channel → store → partner (retail orders have no work-order link). Provide order_ids to target specific orders, or omit for a bounded scan (default 1000, max ${MAX_RETAIL_FEE_BACKFILL_SCAN}). Idempotent: existing fees + canceled orders are skipped. Dry-run previews; apply writes.`,
  params: [
    {
      name: "order_ids",
      type: "string",
      required: false,
      description: "Comma-separated order ids to target (default: scan all retail partner orders)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max fees to accrue in one call (default 1000, max ${MAX_RETAIL_FEE_BACKFILL_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const { order_ids, limit } = paramsSchema.parse(params)

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const billing: any = container.resolve(PARTNER_BILLING_MODULE)

    // Build sales_channel_id → partner_id (partners/stores are few).
    const { data: partnerStoreLinks } = await query.graph({
      entity: "partner_partner_store_store",
      fields: ["partner_id", "store_id"],
      pagination: { skip: 0, take: 1000 },
    })
    const partnerByStore = new Map<string, string>()
    for (const l of partnerStoreLinks || []) {
      if (l?.store_id && l?.partner_id) partnerByStore.set(l.store_id, l.partner_id)
    }

    const { data: salesChannels } = await query.graph({
      entity: "sales_channel",
      fields: ["id", "store.id"],
      pagination: { skip: 0, take: 1000 },
    })
    const partnerBySc = new Map<string, string>()
    for (const sc of salesChannels || []) {
      const pid = sc?.store?.id ? partnerByStore.get(sc.store.id) : undefined
      if (pid) partnerBySc.set(sc.id, pid)
    }

    const ratesByPartner = new Map<string, { gateway_bps: number; commission_bps: number }>()
    const ratesFor = async (pid: string) => {
      let r = ratesByPartner.get(pid)
      if (!r) {
        r = await resolveRetailFeeRates(container, { partnerId: pid })
        ratesByPartner.set(pid, r)
      }
      return r
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let scanned = 0

    const consider = async (order: any) => {
      if (changes.length >= limit) return
      scanned++
      const pid = order?.sales_channel_id
        ? partnerBySc.get(order.sales_channel_id)
        : undefined
      if (!pid) return
      if (String(order?.status) === "canceled") return

      const existing = await billing.findFeeForOrder(order.id)
      if (existing) return

      const { gateway_bps, commission_bps } = await ratesFor(pid)
      const orderTotal = Number(order?.total)
      const split = computeRetailSplitFee(orderTotal, gateway_bps, commission_bps)
      const currencyCode: string = order?.currency_code || ""

      changes.push({
        entity: "partner_fee",
        id: order.id,
        field: "accrue_retail_fee",
        before: null,
        after: {
          partner_id: pid,
          fee_amount: split.total_amount,
          payment_gateway_amount: split.payment_gateway_amount,
          commission_amount: split.commission_amount,
          currency_code: currencyCode,
        },
      })

      if (!dry_run) {
        await billing.createPartnerFees([
          {
            partner_id: pid,
            order_id: order.id,
            order_total: Number.isFinite(orderTotal) ? orderTotal : 0,
            currency_code: currencyCode,
            fee_basis: "percentage",
            fee_rate: split.total_bps,
            fee_amount: split.total_amount,
            fee_type: "retail_split",
            payment_gateway_bps: gateway_bps,
            payment_gateway_amount: split.payment_gateway_amount,
            commission_bps,
            commission_amount: split.commission_amount,
            status: "accrued",
            accrued_at: new Date(),
            metadata: { source: "backfill-retail-partner-fees", kind: "retail" },
          },
        ])
      }
    }

    if (order_ids.length) {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "total", "currency_code", "status", "sales_channel_id"],
        filters: { id: order_ids },
      })
      for (const o of orders || []) {
        try {
          await consider(o)
        } catch (e: any) {
          errors.push({ id: o?.id, message: e?.message ?? String(e) })
        }
      }
    } else {
      const page = 200
      for (let skip = 0; changes.length < limit; skip += page) {
        const { data: orders } = await query.graph({
          entity: "order",
          fields: ["id", "total", "currency_code", "status", "sales_channel_id"],
          pagination: { skip, take: page },
        })
        if (!orders || orders.length === 0) break
        for (const o of orders) {
          if (changes.length >= limit) break
          try {
            await consider(o)
          } catch (e: any) {
            errors.push({ id: o?.id, message: e?.message ?? String(e) })
          }
        }
        if (orders.length < page) break
      }
    }

    return {
      job_id: backfillRetailPartnerFeesJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: `${dry_run ? "Would accrue" : "Accrued"} ${changes.length} retail partner fee(s) across ${partnerBySc.size} partner channel(s) — scanned ${scanned} order(s), ${errors.length} error(s)`,
      changes,
      errors,
    }
  },
}
