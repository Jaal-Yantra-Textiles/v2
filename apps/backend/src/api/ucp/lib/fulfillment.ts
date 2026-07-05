/**
 * UCP Fulfillment Extension formatter.
 *
 * Builds the spec-compliant `fulfillment` object for a UCP checkout session.
 * Spec: https://ucp.dev/specification/fulfillment/
 *
 * Mapping from Medusa v2 → UCP:
 *   - A cart gets exactly ONE fulfillment_method of type "shipping" covering
 *     all line items. If/when pickup support is added, a second method of
 *     type "pickup" can be emitted here.
 *   - The method contains ONE fulfillment_group holding all line items and
 *     the list of available shipping options as fulfillment_options.
 *   - The cart's current shipping_address becomes a single shipping
 *     destination. The cart's currently selected shipping_method (if any)
 *     sets selected_option_id on the group.
 */

import { medusaToUcpAddress } from "./address-translator"

export const UCP_FULFILLMENT_METHOD_SHIPPING_ID = "shipping"
export const UCP_FULFILLMENT_GROUP_DEFAULT_ID = "default"

type ShippingOption = {
  id: string
  name?: string
  amount?: number
  provider_id?: string
  data?: Record<string, unknown>
}

type ShippingMethod = {
  id: string
  shipping_option_id?: string
  name?: string
  amount?: number
}

/**
 * Build the UCP fulfillment object for a cart.
 * Returns undefined if the cart has no line items (nothing to fulfill).
 */
export function buildUcpFulfillment(
  cart: any,
  shippingOptions: ShippingOption[] | undefined
): { methods: any[] } | undefined {
  const items: any[] = cart.items || []
  if (items.length === 0) return undefined

  const lineItemIds: string[] = items.map((i: any) => i.id)

  const destinations: any[] = []
  let selectedDestinationId: string | null = null
  if (cart.shipping_address) {
    const addr = medusaToUcpAddress(cart.shipping_address)
    const destId = cart.shipping_address.id || "cart_shipping_address"
    destinations.push({ id: destId, ...addr })
    selectedDestinationId = destId
  }

  const options: any[] = (shippingOptions || []).map((opt) => {
    const amount = opt.amount ?? 0
    const title = opt.name || "Shipping"
    const result: Record<string, unknown> = {
      id: opt.id,
      title,
      totals: [{ type: "fulfillment", display_text: title, amount }],
    }
    if (opt.provider_id) result.carrier = opt.provider_id
    return result
  })

  const selectedMethod: ShippingMethod | undefined = (cart.shipping_methods || [])[0]
  const selectedOptionId: string | null = selectedMethod?.shipping_option_id || null

  const group: Record<string, unknown> = {
    id: UCP_FULFILLMENT_GROUP_DEFAULT_ID,
    line_item_ids: lineItemIds,
    options,
    selected_option_id: selectedOptionId,
  }

  const method: Record<string, unknown> = {
    id: UCP_FULFILLMENT_METHOD_SHIPPING_ID,
    type: "shipping",
    line_item_ids: lineItemIds,
    destinations,
    selected_destination_id: selectedDestinationId,
    groups: [group],
  }

  return { methods: [method] }
}

/**
 * Parse a UCP fulfillment update payload and extract the selected shipping
 * option id that should be applied to the cart.
 */
export function extractSelectedFulfillmentOptionId(
  fulfillment: unknown
): string | undefined {
  if (!fulfillment || typeof fulfillment !== "object") return undefined
  const f = fulfillment as any
  const methods: any[] = Array.isArray(f.methods) ? f.methods : []
  for (const method of methods) {
    const groups: any[] = Array.isArray(method?.groups) ? method.groups : []
    for (const group of groups) {
      if (typeof group?.selected_option_id === "string" && group.selected_option_id) {
        return group.selected_option_id
      }
    }
  }
  return undefined
}
