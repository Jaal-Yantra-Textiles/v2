import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import qs from "qs"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { partnerDesignsQueryKeys } from "./partner-designs"

const PARTNER_CONSUMPTION_LOGS_QUERY_KEY = "partner-consumption-logs" as const
export const partnerConsumptionLogsQueryKeys = queryKeysFactory(PARTNER_CONSUMPTION_LOGS_QUERY_KEY)

export type ConsumptionLog = {
  id: string
  design_id: string
  inventory_item_id: string
  raw_material_id?: string | null
  quantity: number
  unit_of_measure: string
  consumption_type: "sample" | "production" | "wastage"
  is_committed: boolean
  consumed_by: "admin" | "partner"
  consumed_at: string
  notes?: string | null
  location_id?: string | null
  metadata?: Record<string, any> | null
  created_at?: string
  updated_at?: string
}

export type ConsumptionLogsListResponse = {
  logs: ConsumptionLog[]
  count: number
}

export type LogConsumptionPayload = {
  inventoryItemId: string
  rawMaterialId?: string
  quantity: number
  unitOfMeasure?: string
  consumptionType?: "sample" | "production" | "wastage"
  notes?: string
  locationId?: string
  metadata?: Record<string, any>
}

export type ListConsumptionLogsParams = {
  consumption_type?: string
  is_committed?: string
  consumed_by?: string
  inventory_item_id?: string
  limit?: number
  offset?: number
}

export const usePartnerConsumptionLogs = (
  designId: string,
  params?: ListConsumptionLogsParams,
  options?: Omit<
    UseQueryOptions<
      ConsumptionLogsListResponse,
      FetchError,
      ConsumptionLogsListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerConsumptionLogsQueryKeys.detail(designId, params),
    queryFn: async () => {
      const q = qs.stringify(params || {}, { skipNulls: true })
      return await sdk.client.fetch<ConsumptionLogsListResponse>(
        `/partners/designs/${designId}/consumption-logs${q ? `?${q}` : ""}`,
        { method: "GET" }
      )
    },
    ...options,
  })

  return {
    ...data,
    logs: data?.logs ?? [],
    count: data?.count ?? 0,
    ...rest,
  }
}

export const useLogPartnerConsumption = (
  designId: string,
  options?: UseMutationOptions<
    { consumption_log: ConsumptionLog },
    FetchError,
    LogConsumptionPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) => {
      return await sdk.client.fetch<{ consumption_log: ConsumptionLog }>(
        `/partners/designs/${designId}/consumption-logs`,
        { method: "POST", body: payload }
      )
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerConsumptionLogsQueryKeys.detail(designId),
      })
      await queryClient.invalidateQueries({
        queryKey: partnerDesignsQueryKeys.detail(designId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
