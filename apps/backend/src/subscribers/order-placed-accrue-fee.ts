import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService, Logger } from "@medusajs/types"
import partnerOrderLink from "../links/partner-order"
import { PARTNER_BILLING_MODULE } from "../modules/partner_billing"
import { computeFee } from "../modules/partner_billing/lib/compute-fee"
import { resolvePartnerFeeRate } from "../modules/partner_billing/lib/resolve-fee-rate"

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

    // Gate: resolve the partner via the D3 partner↔order link (source of truth).
    // No link → retail order → no commission.
    const { data: linkRows } = await query.graph({
      entity: partnerOrderLink.entryPoint,
      fields: ["partner_id"],
      filters: { order_id: data.id },
      pagination: { skip: 0, take: 1 },
    })
    const partnerId: string | null = (linkRows || [])[0]?.partner_id || null
    if (!partnerId) {
      return
    }

    // Idempotency: one accrued fee per order.
    const existing = await billingService.findFeeForOrder(data.id)
    if (existing) {
      return
    }

    const orderService = container.resolve(
      Modules.ORDER
    ) as IOrderModuleService
    const order: any = await orderService.retrieveOrder(data.id, {
      select: ["id", "total", "currency_code"],
    })

    const orderTotal = Number(order?.total)
    const currencyCode: string = order?.currency_code || ""

    const { fee_basis, fee_rate } = await resolvePartnerFeeRate(container, {
      partnerId,
    })
    const feeAmount = computeFee(orderTotal, fee_basis, fee_rate)

    await billingService.createPartnerFees([
      {
        partner_id: partnerId,
        order_id: data.id,
        order_total: Number.isFinite(orderTotal) ? orderTotal : 0,
        currency_code: currencyCode,
        fee_basis,
        fee_rate,
        fee_amount: feeAmount,
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
