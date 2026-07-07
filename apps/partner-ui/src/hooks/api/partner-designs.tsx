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

/** #6 — the partner "work" tab buckets (server-side lens over the same set). */
export type DesignBucket = "all" | "incoming" | "in_progress" | "completed" | "yours"

export type DesignBucketFacets = Record<DesignBucket, number>

export type ListPartnerDesignsParams = {
  limit?: number
  offset?: number
  status?: string
  q?: string
  bucket?: DesignBucket
}

export type PartnerDesignListResponse = {
  designs: PartnerDesign[]
  count: number
  /** #6 — per-bucket counts (accurate across all pages) for the work tabs. */
  facets?: DesignBucketFacets
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

// Roadmap #6 Phase 1 — partner-owned design CRUD.
export type CreatePartnerDesignPayload = {
  name: string
  description?: string
  design_type?: "Original" | "Derivative" | "Custom" | "Collaboration"
  status?: string
  priority?: "Low" | "Medium" | "High" | "Urgent"
  tags?: string[]
  estimated_cost?: number
  designer_notes?: string
}

export const useCreatePartnerDesign = (
  options?: UseMutationOptions<
    { design: PartnerDesign },
    FetchError,
    CreatePartnerDesignPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) => {
      return await sdk.client.fetch<{ design: PartnerDesign }>(
        `/partners/designs`,
        { method: "POST", body: payload }
      )
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdatePartnerDesign = (
  id: string,
  options?: UseMutationOptions<
    { design: PartnerDesign },
    FetchError,
    Partial<CreatePartnerDesignPayload>
  >
) => {
  return useMutation({
    mutationFn: async (payload) => {
      return await sdk.client.fetch<{ design: PartnerDesign }>(
        `/partners/designs/${id}`,
        { method: "PUT", body: payload }
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

export const useDeletePartnerDesign = (
  id: string,
  options?: UseMutationOptions<
    { id: string; deleted: boolean },
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: async () => {
      return await sdk.client.fetch<{ id: string; deleted: boolean }>(
        `/partners/designs/${id}`,
        { method: "DELETE" }
      )
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.lists() })
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
          // Medusa JS SDK sets default "content-type: application/json".
          // For multipart, we must delete it and let the browser set the boundary.
          headers: { "content-type": null } as any,
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
