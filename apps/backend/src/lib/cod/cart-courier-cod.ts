import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import {
  type CourierCodDecision,
  courierCodMaxTotal,
  decideCourierCod,
  delhiveryCodForPin,
} from "./courier-cod"

export type CartCourierCod = {
  /** The cart has a shipping method and every one of them is a pickup option. */
  is_pickup: boolean
  /** The cart has a shipping method that is NOT pickup (a courier delivery). */
  is_courier: boolean
  decision: CourierCodDecision
}

/**
 * Courier-COD eligibility for one cart, read from the database (never from the
 * request). Shared by the cart-completion guard and the delivery check so the
 * checkout offers exactly what the server will accept.
 *
 * `delhiveryCod` lets the caller pass an answer it already has (the delivery
 * check's cached Delhivery lookup); omitted, Delhivery is asked now.
 */
export async function evaluateCartCourierCod(
  scope: any,
  cartId: string,
  opts: {
    delhiveryCod?: boolean | null
    /** Judge this address instead of the cart's saved one (the PIN being typed). */
    address?: { country_code: string; postal_code: string }
  } = {}
): Promise<(CartCourierCod & { sales_channel_id: string | null }) | null> {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "currency_code",
      "total",
      "metadata",
      "sales_channel_id",
      "shipping_address.country_code",
      "shipping_address.postal_code",
      "shipping_methods.shipping_option_id",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0]
  if (!cart) return null

  const optionIds: string[] = [
    ...new Set<string>(
      (cart.shipping_methods ?? [])
        .map((m: any) => m?.shipping_option_id)
        .filter(Boolean)
    ),
  ]
  let types: string[] = []
  if (optionIds.length) {
    const { data: options } = await query.graph({
      entity: "shipping_option",
      fields: ["id", "service_zone.fulfillment_set.type"],
      filters: { id: optionIds },
    })
    types = (options ?? []).map((o: any) => String(o?.service_zone?.fulfillment_set?.type ?? ""))
  }
  const is_pickup = types.length > 0 && types.every((t) => t === "pickup")
  // A shipping method whose option we can't read counts as courier: the
  // stricter rule applies when we don't know.
  const is_courier =
    (cart.shipping_methods ?? []).length > 0 &&
    (types.length < optionIds.length || types.some((t) => t !== "pickup"))

  let has_payment_schedule = false
  try {
    const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
    has_payment_schedule = !!(await schedules.findByCartId(cart.id))
  } catch {
    // Can't tell → treat as scheduled. A deposit order must never go COD.
    has_payment_schedule = true
  }

  const max_total = courierCodMaxTotal()
  const country = opts.address?.country_code ?? cart.shipping_address?.country_code ?? null
  const pin = String(opts.address?.postal_code ?? cart.shipping_address?.postal_code ?? "")
  const sales_channel_id: string | null = cart.sales_channel_id ?? null

  // Only spend a Delhivery call when everything else already says yes.
  const pre = decideCourierCod({
    country_code: country,
    currency_code: cart.currency_code,
    total: cart.total,
    is_design_order: (cart.metadata as any)?.source === "design-order",
    has_payment_schedule,
    delhivery_cod: true,
    max_total,
  })
  if (!pre.allowed) return { is_pickup, is_courier, sales_channel_id, decision: pre }

  const delhivery_cod =
    opts.delhiveryCod !== undefined ? opts.delhiveryCod : await delhiveryCodForPin(scope, pin)

  return {
    is_pickup,
    is_courier,
    sales_channel_id,
    decision: decideCourierCod({
      country_code: country,
      currency_code: cart.currency_code,
      total: cart.total,
      is_design_order: false,
      has_payment_schedule: false,
      delhivery_cod,
      max_total,
    }),
  }
}
