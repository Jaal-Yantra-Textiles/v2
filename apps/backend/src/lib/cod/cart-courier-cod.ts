import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import {
  type CourierCodDecision,
  courierCodMaxTotal,
  decideCourierCod,
  delhiveryCodForPin,
} from "./courier-cod"

/** Where the COD fee is recorded on the courier shipping method's `data`. */
export const COD_FEE_DATA_KEY = "cod_fee"

export type CourierShippingMethod = {
  id: string
  amount: number
  /** The COD fee already inside `amount` (pre-tax), 0 when none. */
  cod_fee: number
  data: Record<string, unknown>
}

export type CartCourierCod = {
  /** The cart has a shipping method and every one of them is a pickup option. */
  is_pickup: boolean
  /** The cart has a shipping method that is NOT pickup (a courier delivery). */
  is_courier: boolean
  /** The first courier shipping method — where the COD fee lives. */
  courier_method: CourierShippingMethod | null
  /** The cart total the cap is compared with: the total WITHOUT the COD fee. */
  total_before_fee: number | null
  decision: CourierCodDecision
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Courier-COD eligibility for one cart, read from the database (never from the
 * request). Shared by the cart-completion guard, the payment-session route
 * (which adds or removes the COD fee) and the delivery check, so the checkout
 * offers exactly what the server will accept.
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
      "shipping_methods.id",
      "shipping_methods.amount",
      "shipping_methods.total",
      "shipping_methods.data",
      "shipping_methods.shipping_option_id",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0]
  if (!cart) return null

  const methods: any[] = cart.shipping_methods ?? []
  const optionIds: string[] = [
    ...new Set<string>(methods.map((m: any) => m?.shipping_option_id).filter(Boolean)),
  ]
  const typeByOption = new Map<string, string>()
  if (optionIds.length) {
    const { data: options } = await query.graph({
      entity: "shipping_option",
      fields: ["id", "service_zone.fulfillment_set.type"],
      filters: { id: optionIds },
    })
    for (const o of options ?? []) {
      typeByOption.set(o.id, String(o?.service_zone?.fulfillment_set?.type ?? ""))
    }
  }
  // A method whose option we can't read counts as courier: the stricter rule
  // applies when we don't know.
  const isCourierMethod = (m: any) => typeByOption.get(m?.shipping_option_id) !== "pickup"
  const is_courier = methods.some(isCourierMethod)
  const is_pickup = methods.length > 0 && !is_courier

  const courier = methods.find(isCourierMethod)
  const courier_method: CourierShippingMethod | null = courier
    ? {
        id: courier.id,
        amount: num(courier.amount),
        cod_fee: num(courier.data?.[COD_FEE_DATA_KEY]),
        data: (courier.data ?? {}) as Record<string, unknown>,
      }
    : null

  // The fee's share of the cart total, WITH its tax: the method's total
  // scaled by fee / amount. The cap is judged on the cart without the fee.
  const feeShare = methods.reduce((sum: number, m: any) => {
    const fee = num(m?.data?.[COD_FEE_DATA_KEY])
    const amount = num(m?.amount)
    if (!fee || !amount) return sum
    return sum + (num(m?.total) || amount) * (fee / amount)
  }, 0)
  const total_before_fee =
    cart.total == null ? null : Math.round((num(cart.total) - feeShare) * 100) / 100

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
  const base = { is_pickup, is_courier, courier_method, total_before_fee, sales_channel_id }

  // Only spend a Delhivery call when everything else already says yes.
  const pre = decideCourierCod({
    country_code: country,
    currency_code: cart.currency_code,
    total: total_before_fee,
    is_design_order: (cart.metadata as any)?.source === "design-order",
    has_payment_schedule,
    delhivery_cod: true,
    max_total,
  })
  if (!pre.allowed) return { ...base, decision: pre }

  const delhivery_cod =
    opts.delhiveryCod !== undefined ? opts.delhiveryCod : await delhiveryCodForPin(scope, pin)

  return {
    ...base,
    decision: decideCourierCod({
      country_code: country,
      currency_code: cart.currency_code,
      total: total_before_fee,
      is_design_order: false,
      has_payment_schedule: false,
      delhivery_cod,
      max_total,
    }),
  }
}
