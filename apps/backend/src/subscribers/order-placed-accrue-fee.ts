import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService, Logger } from "@medusajs/types"
import partnerOrderLink from "../links/partner-order"
import { PARTNER_BILLING_MODULE } from "../modules/partner_billing"
import { computeFee, computeRetailSplitFee } from "../modules/partner_billing/compute-fee"
import {
  resolvePartnerFeeRate,
  resolveRetailFeeRates,
} from "../modules/partner_billing/resolve-fee-rate"
import { resolveRetailPartnerId } from "../modules/partner_billing/resolve-retail-partner"

/**
 * #336 Slice 2 — partner transaction-fee accrual.
 *
 * Sibling subscriber on `order.placed` (kept separate from `order-placed.ts` so
 * fee accrual can never break order confirmation / production-run creation, and
 * vice-versa). For a partner-linked order only, accrues ONE `partner_fee` row:
 * the platform commission (default 2% — `PLATFORM_TX_FEE_BPS=200`) of the order
 * total, deducted from the partner's payout (a COMMISSION, not a customer charge
 * and not a tax).
 *
 * GATING — `order.placed` fires for retail orders too. We accrue ONLY when the
 * D3 partner↔order link (`src/links/partner-order.ts`) resolves a partner; retail
 * orders have no such link and are skipped (else we'd bill the platform store).
 *
 * IDEMPOTENCY — `order.placed` can re-fire; `findFeeForOrder` keys on `order_id`
 * and we skip if a fee already exists.
 *
 * CURRENCY — accrue in the order's own `currency_code` (post-#485: never grab
 * `stores[0]`).
 *
 * Best-effort: any failure is logged and swallowed — accrual must never throw
 * out of the placement event.
 */
export default async function orderPlacedAccrueFeeHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const billingService: any = container.resolve(PARTNER_BILLING_MODULE)

    // Gate: resolve the partner. Work-orders (design/inventory) carry the D3
    // partner↔order link and accrue the legacy flat commission. Retail orders
    // have NO such link — resolve their partner via the sales channel's store
    // and accrue the retail split (gateway + commission). Non-partner (platform)
    // retail orders resolve neither and are skipped.
    const { data: linkRows } = await query.graph({
      entity: partnerOrderLink.entryPoint,
      fields: ["partner_id"],
      filters: { order_id: data.id },
      pagination: { skip: 0, take: 1 },
    })
    let partnerId: string | null = (linkRows || [])[0]?.partner_id || null
    let isRetail = false

    const orderService = container.resolve(
      Modules.ORDER
    ) as IOrderModuleService
    const order: any = await orderService.retrieveOrder(data.id, {
      select: ["id", "total", "currency_code", "sales_channel_id"],
    })

    if (!partnerId) {
      partnerId = await resolveRetailPartnerId(container, order?.sales_channel_id)
      isRetail = Boolean(partnerId)
    }
    if (!partnerId) {
      return
    }

    // Idempotency: one accrued fee per order.
    const existing = await billingService.findFeeForOrder(data.id)
    if (existing) {
      return
    }

    const orderTotal = Number(order?.total)
    const currencyCode: string = order?.currency_code || ""
    const safeTotal = Number.isFinite(orderTotal) ? orderTotal : 0

    if (isRetail) {
      // Retail split: 2% payment gateway + 15% commission on the order total.
      const { gateway_bps, commission_bps } = await resolveRetailFeeRates(
        container,
        { partnerId }
      )
      const split = computeRetailSplitFee(orderTotal, gateway_bps, commission_bps)

      await billingService.createPartnerFees([
        {
          partner_id: partnerId,
          order_id: data.id,
          order_total: safeTotal,
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
          metadata: { source: "order.placed", kind: "retail" },
        },
      ])

      logger.info(
        `[order.placed] Accrued retail partner fee ${split.total_amount} ${currencyCode} ` +
          `(gateway ${split.payment_gateway_amount} + commission ${split.commission_amount}) ` +
          `for partner ${partnerId} on order ${data.id}`
      )
      return
    }

    // Work-order: legacy flat commission (default 2%).
    const { fee_basis, fee_rate } = await resolvePartnerFeeRate(container, {
      partnerId,
    })
    const feeAmount = computeFee(orderTotal, fee_basis, fee_rate)

    await billingService.createPartnerFees([
      {
        partner_id: partnerId,
        order_id: data.id,
        order_total: safeTotal,
        currency_code: currencyCode,
        fee_basis,
        fee_rate,
        fee_amount: feeAmount,
        fee_type: "commission",
        status: "accrued",
        accrued_at: new Date(),
        metadata: { source: "order.placed" },
      },
    ])

    logger.info(
      `[order.placed] Accrued partner fee ${feeAmount} ${currencyCode} for partner ${partnerId} on order ${data.id}`
    )
  } catch (e: any) {
    logger.warn(
      `[order.placed] Partner fee accrual failed for order ${data.id}: ${
        e?.message || e
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
