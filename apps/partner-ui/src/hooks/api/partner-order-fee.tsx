import { FetchError } from "@medusajs/js-sdk"
import { useQuery, UseQueryOptions } from "@tanstack/react-query"

import { sdk } from "../../lib/client"

// #623 (follow-up to #336): read the platform commission accrued for a single
// order the partner fulfils, from the partner mirror route
// `GET /partners/orders/:id/partner-fee` (ownership-scoped server-side).

export type PartnerOrderFeeDisplay = {
  order_id: string
  status: string
  fee_basis: "percentage" | "flat"
  rate_label: string
  fee_amount: number
  order_total: number
  currency_code: string
  is_collectible: boolean
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
