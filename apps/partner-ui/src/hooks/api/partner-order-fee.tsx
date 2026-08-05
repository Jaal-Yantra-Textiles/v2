import { FetchError } from "@medusajs/js-sdk"
import { useQuery, UseQueryOptions } from "@tanstack/react-query"

import { sdk } from "../../lib/client"

// #623 (follow-up to #336): read the platform commission accrued for a single
// order the partner fulfils, from the partner mirror route
// `GET /partners/orders/:id/partner-fee` (ownership-scoped server-side).

/** Platform-shipping deduction, when the partner shipped on OUR carrier account. */
export type PartnerOrderShippingCharge = {
  amount: number
  currency_code: string
  carrier: string | null
  /** Carrier quoted in a currency other than the order's — show it separately. */
  is_foreign_currency: boolean
}

export type PartnerOrderFeeDisplay = {
  order_id: string
  status: string
  fee_basis: "percentage" | "flat"
  rate_label: string
  fee_amount: number
  order_total: number
  currency_code: string
  is_collectible: boolean
  /** Null when the partner shipped on their own account. */
  shipping: PartnerOrderShippingCharge | null
  /** order_total − commission − platform shipping. */
  net_payout: number
}

export type PartnerOrderFeeResponse = {
  order_id: string
  fee: unknown | null
  display: PartnerOrderFeeDisplay | null
}

export const usePartnerOrderFee = (
  orderId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerOrderFeeResponse,
      FetchError,
      PartnerOrderFeeResponse,
      (string | undefined)[]
    >,
    "queryFn" | "queryKey"
  >
) => {
  return useQuery({
    queryFn: () =>
      sdk.client.fetch<PartnerOrderFeeResponse>(
        `/partners/orders/${orderId}/partner-fee`,
        { method: "GET" }
      ),
    queryKey: ["partner-order-fee", orderId],
    ...options,
  })
}
