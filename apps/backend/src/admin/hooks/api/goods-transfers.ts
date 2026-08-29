import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { productionRunQueryKeys } from "./production-runs"

/**
 * Goods transfers on a production run (#891), for the ADMIN dashboard.
 *
 * The routes have existed since #891 S1; only partner-ui ever grew a surface
 * for them, so every admin transfer to date — including the live
 * Shramdaan → Dharamshala hop — was booked by hand against the API. That is
 * fine for a verification run and no way to operate: a hop the carrier
 * cancelled cannot be corrected by someone who cannot see it.
 */

const GOODS_TRANSFERS_QUERY_KEY = "goods-transfers" as const
export const goodsTransferQueryKeys = queryKeysFactory(GOODS_TRANSFERS_QUERY_KEY)

export type GoodsTransferStatus = "draft" | "in_transit" | "delivered" | "cancelled"

export type AdminGoodsTransfer = {
  id: string
  production_run_id: string
  design_id: string | null
  quantity: number
  from_location_id: string
  to_location_id: string | null
  reason: "finishing" | "qc" | "packaging" | "stock" | "customer" | "other"
  status: GoodsTransferStatus
  shipment_id: string | null
  /**
   * Whether a carrier was booked for this hop — and whether we can still see it
   * (#1553). THREE values, not two: `unresolved` means `shipment_id` names a
   * shipment the server could not read, which must never render as "no carrier
   * booked" — that is how someone re-books goods already collected.
   */
  carrier_state?: "not_booked" | "booked" | "unresolved"
  /** The waybill facts. Null unless `carrier_state` is `booked`. */
  shipment?: {
    shipment_id: string
    carrier: string | null
    awb: string | null
    tracking_number: string | null
    tracking_url: string | null
    label_url: string | null
    status: string | null
    pickup_location_name: string | null
    pickup_scheduled_date: string | null
  } | null
  shipped_at: string | null
  received_at: string | null
  received_quantity: number | null
  notes: string | null
  /** Carries `replaces_transfer_id` / `replaced_by_transfer_id` and the cancellation record. */
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

export type AdminGoodsTransfersResponse = {
  goods_transfers: AdminGoodsTransfer[]
}

export type AdminCreateGoodsTransferPayload = {
  to_location_id: string
  from_location_id?: string
  reason?: AdminGoodsTransfer["reason"]
  quantity?: number
  /** Omit for a self-driven hop — a real movement with no AWB. */
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
  /** The cancelled hop this one re-books. Must be cancelled, and on this run. */
  replaces_transfer_id?: string
}

export type AdminCancelGoodsTransferPayload = {
  /**
   * "The carrier has already cancelled this waybill." Required for a booked
   * transfer — the route does not call the carrier, it records that someone
   * did.
   */
  carrier_cancelled?: boolean
  reason?: string
}

export const useGoodsTransfers = (
  productionRunId: string,
  options?: Omit<
    UseQueryOptions<
      AdminGoodsTransfersResponse,
      FetchError,
      AdminGoodsTransfersResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: goodsTransferQueryKeys.list(productionRunId),
    queryFn: async () =>
      sdk.client.fetch<AdminGoodsTransfersResponse>(
        `/admin/production-runs/${productionRunId}/transfers`,
        { method: "GET" }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

/**
 * Everything that changes a transfer invalidates the run's DETAIL too, not just
 * the transfer list: the run page reads its goods location from a delivered
 * transfer, and the activity timeline gains a row on every one of these calls.
 */
const invalidate = (queryClient: any, productionRunId: string) => {
  queryClient.invalidateQueries({
    queryKey: goodsTransferQueryKeys.list(productionRunId),
  })
  queryClient.invalidateQueries({
    queryKey: productionRunQueryKeys.detail(productionRunId),
  })
}

export const useCreateGoodsTransfer = (
  productionRunId: string,
  options?: UseMutationOptions<
    { goods_transfer: any },
    FetchError,
    AdminCreateGoodsTransferPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminCreateGoodsTransferPayload) =>
      sdk.client.fetch<{ goods_transfer: any }>(
        `/admin/production-runs/${productionRunId}/transfers`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      invalidate(queryClient, productionRunId)
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

/**
 * Cancel a BOOKED hop, recording that the carrier already cancelled it.
 * A draft is cancelled by `useDeleteGoodsTransfer` below — same outcome, but
 * the two are separate calls because only one of them is an assertion about
 * something that happened outside this system.
 */
export const useCancelGoodsTransfer = (
  productionRunId: string,
  options?: UseMutationOptions<
    { goods_transfer: AdminGoodsTransfer },
    FetchError,
    { transferId: string } & AdminCancelGoodsTransferPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ transferId, ...body }) =>
      sdk.client.fetch<{ goods_transfer: AdminGoodsTransfer }>(
        `/admin/production-runs/${productionRunId}/transfers/${transferId}/cancel`,
        { method: "POST", body }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      invalidate(queryClient, productionRunId)
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export const useDeleteGoodsTransfer = (
  productionRunId: string,
  options?: UseMutationOptions<
    { goods_transfer: AdminGoodsTransfer },
    FetchError,
    string
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (transferId: string) =>
      sdk.client.fetch<{ goods_transfer: AdminGoodsTransfer }>(
        `/admin/production-runs/${productionRunId}/transfers/${transferId}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      invalidate(queryClient, productionRunId)
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}
