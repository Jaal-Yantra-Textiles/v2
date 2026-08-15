import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  planShippingFxConversion,
  type ShippingFxRecord,
} from "../../modules/partner_billing/shipping-ledger"
import { FX_RATES_MODULE } from "../../modules/fx_rates"
import type FxRatesService from "../../modules/fx_rates/service"

/**
 * Convert a carrier's freight quote into the order's currency, at the container
 * edge.
 *
 * This lives in `workflows/`, not in `partner_billing`, for a reason that is
 * structural rather than stylistic: under module isolation a module's service
 * gets the MODULE container and cannot resolve another module, so
 * `PartnerBillingService` can never reach `fx_rates`. (Same constraint that
 * forces Blue Dart's credentials to exist in two places — see #1285.) Anything
 * needing both must be composed one level up, where the full container is in
 * hand. So the rate is resolved here and handed to the ledger as a finished
 * fact, and `planShippingFxConversion` stays pure and unit-testable.
 *
 * ## Why a foreign charge was excluded before this
 *
 * `rollUpShippingScalars` and `describeFee` both drop charges quoted outside the
 * order currency, with the same comment: converting there would mean inventing
 * an FX rate a pure function has no business choosing. That was right. This does
 * not change the rule — it supplies the rate from outside, records it, and lets
 * the existing rule find the line already in the right currency.
 *
 * ## Failure is not an error
 *
 * Every failure path returns `null`, meaning "record the charge unconverted".
 * That is exactly today's behaviour: the line shows in the UI in its own
 * currency and is not deducted. A missing rate must never block attaching a
 * waybill — the parcel has shipped either way, and an operator who cannot record
 * a shipment because an FX cache is cold will record it somewhere we cannot see.
 */
export type ResolveShippingFxInput = {
  amount: number
  currency_code: string
  /** The order's currency — the target. */
  orderCurrency: string | null | undefined
  /**
   * A rate the operator supplied, e.g. what their bank actually billed. Always
   * preferred over the cached market rate: only this one reconciles against a
   * statement. `fx_rates` is the fallback, not the authority.
   */
  operatorRate?: number | null
  /** Injected so callers control the clock (and tests don't need to freeze it). */
  now?: string
}

export type ResolvedShippingFx = {
  amount: number
  currency_code: string
  fx: ShippingFxRecord
} | null

export async function resolveShippingFx(
  container: MedusaContainer,
  input: ResolveShippingFxInput
): Promise<ResolvedShippingFx> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const from = String(input.currency_code || "").toUpperCase()
  const to = String(input.orderCurrency || "").toUpperCase()
  const convertedAt = input.now || new Date().toISOString()

  if (!from || !to || from === to) {
    return null
  }

  // An operator-supplied rate short-circuits the lookup entirely. It is the
  // rate that was actually paid; a market rate fetched a day later is not.
  const operatorRate = Number(input.operatorRate)
  if (Number.isFinite(operatorRate) && operatorRate > 0) {
    return planShippingFxConversion({
      amount: input.amount,
      currency_code: from,
      orderCurrency: to,
      rate: operatorRate,
      source: "operator",
      convertedAt,
    })
  }

  try {
    const fx = container.resolve(FX_RATES_MODULE) as FxRatesService
    const rate = await fx.getRate(from, to)
    return planShippingFxConversion({
      amount: input.amount,
      currency_code: from,
      orderCurrency: to,
      rate,
      source: "fx_rates",
      convertedAt,
    })
  } catch (e: any) {
    // `getRate` throws NOT_FOUND when the cache has no path between the two
    // currencies — a cold cache, or a currency the provider doesn't quote.
    logger?.warn?.(
      `[shipping-fx] no ${from}->${to} rate (${e?.message}); recording the charge unconverted, so it will show in ${from} and not be deducted.`
    )
    return null
  }
}
