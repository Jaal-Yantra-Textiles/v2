import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { evaluateCartCourierCod } from "../../../lib/cod/cart-courier-cod"
import { courierCodFee } from "../../../lib/cod/courier-cod"
import { runDeliveryCheck } from "../../../lib/delivery-check"
import { normalizePostalCode } from "../../../lib/delivery-check/validate"
import { getStoreFromPublishableKey } from "../helpers"
import type { StoreDeliveryCheckReq } from "./validators"

/**
 * GET /store/delivery-check?country_code=in&postal_code=110001[&variant_id=|&cart_id=]
 *
 * Do we deliver to this pin / postcode, roughly when, and is cash on delivery
 * available? Read-only. The store (and so the ship-from location) comes from
 * the publishable key, which Medusa requires on every /store route.
 *
 * 🔑 This route never answers 500 to the storefront. A bad postcode is a 200
 * with `serviceable: null`, `invalid: true` and a message to show; a carrier
 * outage is a 200 with `serviceable: null` and a soft message.
 *
 * Response: { serviceable, cod_available, eta_days: {min,max}|null, message,
 * source: [carriers], country_code, postal_code, cache_hit }
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = req.validatedQuery as unknown as StoreDeliveryCheckReq
  const salesChannelIds: string[] =
    (req as any).publishable_key_context?.sales_channel_ids ?? []

  const postal = normalizePostalCode(q.country_code, q.postal_code)
  if (!postal.ok) {
    return res.json({
      serviceable: null,
      cod_available: null,
      eta_days: null,
      message: postal.message,
      source: [],
      country_code: String(q.country_code || "").toLowerCase(),
      postal_code: String(q.postal_code || ""),
      invalid: true,
    })
  }

  try {
    const store = await getStoreFromPublishableKey(
      { sales_channel_ids: salesChannelIds },
      req.scope
    )
    const result = await runDeliveryCheck(req.scope, {
      store,
      sales_channel_ids: salesChannelIds,
      country_code: postal.country_code,
      postal_code: postal.postal_code,
      variant_id: q.variant_id,
      cart_id: q.cart_id,
    })

    /**
     * With a cart: may this cart pay cash to the courier, at THIS address?
     * The same rule the cart-completion guard enforces, fed Delhivery's
     * answer from the (cached, budgeted) check above — so the checkout offers
     * cash exactly when the server will accept it. Only this store's carts.
     */
    let courier_cod: { allowed: boolean; reason: string; fee: number } | null = null
    if (q.cart_id) {
      try {
        const evaluated = await evaluateCartCourierCod(req.scope, q.cart_id, {
          delhiveryCod: result.delhivery_cod ?? null,
          address: { country_code: postal.country_code, postal_code: postal.postal_code },
        })
        if (evaluated && salesChannelIds.includes(evaluated.sales_channel_id ?? "")) {
          courier_cod = {
            allowed: evaluated.decision.allowed,
            reason: evaluated.decision.reason,
            // Shown to the buyer BEFORE they choose cash (INR, pre-tax; it is
            // taxed as shipping is).
            fee: courierCodFee(),
          }
        }
      } catch {
        courier_cod = null
      }
    }
    return res.json({ ...result, courier_cod })
  } catch (e: any) {
    const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(`[delivery-check] unexpected failure: ${e?.message || e}`)
    return res.json({
      serviceable: null,
      cod_available: null,
      eta_days: null,
      message:
        "We couldn't check delivery right now. You can still place your order.",
      source: [],
      country_code: postal.country_code,
      postal_code: postal.postal_code,
    })
  }
}
