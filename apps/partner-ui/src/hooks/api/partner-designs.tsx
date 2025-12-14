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

const PARTNER_DESIGNS_QUERY_KEY = "partner-designs" as const
export const partnerDesignsQueryKeys = queryKeysFactory(PARTNER_DESIGNS_QUERY_KEY)

export type PartnerDesignPartnerInfo = {
  partner_status?: "incoming" | "assigned" | "in_progress" | "finished" | "completed"
  partner_phase?: "redo" | null
  partner_started_at?: string | null
  partner_finished_at?: string | null
  partner_completed_at?: string | null
  workflow_tasks_count?: number
  assigned_partner_id?: string
}

export type PartnerDesign = Record<string, any> & {
  id: string
  name?: string | null
  status?: string | null
  created_at?: string
  updated_at?: string
  partner_info?: PartnerDesignPartnerInfo
  inventory_items?: Array<Record<string, any>>
}

export type ListPartnerDesignsParams = {
  limit?: number
  offset?: number
  status?: string
}

export type PartnerDesignListResponse = {
  designs: PartnerDesign[]
  count: number
  limit: number
  offset: number
}

export type PartnerDesignDetailResponse = {
  design: PartnerDesign
}

const buildQuery = (params?: Record<string, any>) => {
  const query = qs.stringify(params || {}, { skipNulls: true })
  return query ? `?${query}` : ""
}

export const usePartnerDesigns = (
  params?: ListPartnerDesignsParams,
  options?: Omit<
    UseQueryOptions<
      PartnerDesignListResponse,
      FetchError,
      PartnerDesignListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerDesignsQueryKeys.list(params),
    queryFn: async () => {
      const q = buildQuery(params)
      return await sdk.client.fetch<PartnerDesignListResponse>(
        `/partners/designs${q}`,
        {
          method: "GET",
        }
      )
    },
    ...options,
  })

  return {
    ...data,
    designs: data?.designs ?? [],
    ...rest,
  }
}

export const usePartnerDesign = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      PartnerDesignDetailResponse,
      FetchError,
      PartnerDesignDetailResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerDesignsQueryKeys.detail(id),
    queryFn: async () => {
      return await sdk.client.fetch<PartnerDesignDetailResponse>(
        `/partners/designs/${id}`,
        {
          method: "GET",
        }
      )
    },
    ...options,
  })

  return {
    ...data,
    design: data?.design,
    ...rest,
  }
}

export const useStartPartnerDesign = (
  id: string,
  options?: UseMutationOptions<{ message: string; design: PartnerDesign }, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () => {
      return await sdk.client.fetch<{ message: string; design: PartnerDesign }>(
        `/partners/designs/${id}/start`,
        { method: "POST" }
      )
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.lists() })
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export type PartnerDesignConsumption = {
  inventory_item_id: string
  quantity: number
  location_id?: string
}

export const useCompletePartnerDesign = (
  id: string,
  options?: UseMutationOptions<
    { message: string; design?: PartnerDesign; result?: any },
    FetchError,
    { consumptions: PartnerDesignConsumption[] }
  >
) => {
  return useMutation({
    mutationFn: async (payload) => {
      return await sdk.client.fetch<{
        message: string
        design?: PartnerDesign
        result?: any
      }>(`/partners/designs/${id}/complete`, {
        method: "POST",
        body: payload,
      })
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.lists() })
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUploadPartnerDesignMedia = (
  id: string,
  options?: UseMutationOptions<{ files: Array<{ id?: string; url: string }> }, FetchError, FormData>
) => {
  return useMutation({
    mutationFn: async (formData) => {
      return await sdk.client.fetch<{ files: Array<{ id?: string; url: string }> }>(
        `/partners/designs/${id}/media`,
        {
          method: "POST",
          body: formData,
        }
      )
    },
    ...options,
  })
}

export const useAttachPartnerDesignMedia = (
  id: string,
  options?: UseMutationOptions<
    { message: string; design?: PartnerDesign },
    FetchError,
    { media_files: Array<{ id?: string; url: string; isThumbnail?: boolean }>; metadata?: Record<string, unknown> }
  >
) => {
  return useMutation({
    mutationFn: async (payload) => {
      return await sdk.client.fetch<{ message: string; design?: PartnerDesign }>(
        `/partners/designs/${id}/media/attach`,
        {
          method: "POST",
          body: payload,
        }
      )
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
