import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"

import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

/**
 * #891 — post-production goods movement for one of the partner's own runs.
 *
 * A run's output frequently has to travel before it can be sold: to a finishing
 * or QC partner, to a packaging warehouse, or into stock. These drive
 * `/partners/production-runs/:id/transfers`, which reuses the same carrier
 * machinery as every other shipment (Shiprocket and Delhivery both work).
 *
 * The carrier is optional on purpose — a van run between two of our own
 * locations is a real movement, and refusing to record it would just push the
 * truth back out of the system.
 */

const GOODS_TRANSFERS_QUERY_KEY = "goods_transfers" as const
export const goodsTransfersQueryKeys = queryKeysFactory(
  GOODS_TRANSFERS_QUERY_KEY
)

export type GoodsTransfer = {
  id: string
  production_run_id: string
  design_id?: string | null
  quantity: number
  from_location_id: string
  to_location_id?: string | null
  reason: "finishing" | "qc" | "packaging" | "stock" | "customer" | "other"
  status: "draft" | "in_transit" | "delivered" | "cancelled"
  shipment_id?: string | null
  shipped_at?: string | null
  received_at?: string | null
  notes?: string | null
  created_at?: string
}

export type GoodsTransfersResponse = { goods_transfers: GoodsTransfer[] }

export type CreateGoodsTransferPayload = {
  to_location_id: string
  from_location_id?: string
  reason?: GoodsTransfer["reason"]
  quantity?: number
  /** Omit to record the hop without booking a carrier. */
  carrier?: string
  weight_grams?: number
  dimensions_cm?: {
    length?: number
    width?: number
    breadth?: number
    height?: number
  }
  preferred_courier_id?: string | number
  notes?: string
}

export type CreateGoodsTransferResponse = {
  goods_transfer: {
    transfer_id: string
    status: string
    from_location_id: string
    to_location_id: string
    quantity: number
    carrier?: string
    awb?: string
    tracking_url?: string
    label_url?: string
    shipment_id?: string
  }
}

export const usePartnerGoodsTransfers = (
  runId: string,
  options?: Omit<
    UseQueryOptions<
      GoodsTransfersResponse,
      FetchError,
      GoodsTransfersResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) =>
  useQuery({
    queryFn: () =>
      sdk.client.fetch<GoodsTransfersResponse>(
        `/partners/production-runs/${runId}/transfers`,
        { method: "GET" }
      ),
    queryKey: goodsTransfersQueryKeys.list(runId),
    ...options,
    enabled: !!runId && options?.enabled !== false,
  })

export const useCreatePartnerGoodsTransfer = (
  runId: string,
  options?: UseMutationOptions<
    CreateGoodsTransferResponse,
    FetchError,
    CreateGoodsTransferPayload
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateGoodsTransferPayload) =>
      sdk.client.fetch<CreateGoodsTransferResponse>(
        `/partners/production-runs/${runId}/transfers`,
        // The SDK client serialises the body itself — pre-stringifying sends a
        // quoted string the route can't parse.
        { method: "POST", body: payload }
      ),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: goodsTransfersQueryKeys.list(runId),
      })
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}
