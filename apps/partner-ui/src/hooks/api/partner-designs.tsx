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

/** #1113 S3 — the Excalidraw scene shape stored in the `moodboard` column. */
export type MoodboardScene = {
  type?: string
  version?: number
  source?: string
  elements?: any[]
  appState?: Record<string, any>
  files?: Record<string, any>
}

/**
 * #1113 S3 — regenerate the brief-as-cards moodboard from the design's
 * structured columns (owner OR invited/assigned designer). Returns the merged
 * scene; the caller loads it straight into the canvas.
 */
export const useGenerateMoodboard = (
  id: string,
  options?: UseMutationOptions<{ moodboard: MoodboardScene }, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () => {
      return await sdk.client.fetch<{ moodboard: MoodboardScene }>(
        `/partners/designs/${id}/moodboard/generate`,
        { method: "POST" }
      )
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/** #1113 S3+ — one insertable moodboard block in the palette. */
export type MoodboardBlockListing = {
  key: string
  label: string
  group: string
  available: boolean
}

/**
 * #1113 S3+ — the insert-block palette: every drop-in frame the designer can
 * add to the canvas, flagged by whether the design has data for it. Owner OR
 * assigned/invited designer.
 */
export const useMoodboardBlocks = (
  id: string,
  options?: Omit<
    UseQueryOptions<{ blocks: MoodboardBlockListing[] }, FetchError>,
    "queryKey" | "queryFn"
  >
) => {
  return useQuery({
    queryKey: [...partnerDesignsQueryKeys.detail(id), "moodboard-blocks"],
    queryFn: async () =>
      sdk.client.fetch<{ blocks: MoodboardBlockListing[] }>(
        `/partners/designs/${id}/moodboard/blocks`,
        { method: "GET" }
      ),
    enabled: !!id,
    ...options,
  })
}

/**
 * #1113 S3+ — build ONE block from the design's current data (positioned at
 * origin). Not persisted server-side: the caller translates + re-ids it onto
 * the live canvas, then saves via useSaveMoodboard.
 */
export const useInsertMoodboardBlock = (
  id: string,
  options?: UseMutationOptions<{ block: MoodboardScene }, FetchError, string>
) => {
  return useMutation({
    mutationFn: async (block: string) =>
      sdk.client.fetch<{ block: MoodboardScene }>(
        `/partners/designs/${id}/moodboard/blocks`,
        { method: "POST", body: { block } }
      ),
    ...options,
  })
}

// ── Construction techniques (#1113 Feature B) ────────────────────────────────

export type ConstructionParamDef = {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}
export type ConstructionPreset = {
  value: string
  label: string
  detailLabel: string
  params?: Record<string, number>
  fabricRules?: string[]
  note?: string
}
export type ConstructionTechnique = {
  slug: string
  label: string
  family: string
  garmentAreas: string[]
  params: ConstructionParamDef[]
  defaultFabricRules: string[]
  presets: ConstructionPreset[]
}
export type ConstructionCatalog = {
  families: string[]
  techniques: ConstructionTechnique[]
}
export type ConstructionDetailRecord = {
  id: string
  title?: string | null
  details?: string | null
  metadata?: {
    technique?: string
    params?: Record<string, number>
    fabricRules?: string[]
  } | null
}
export type CreateConstructionPayload = {
  technique: string
  label?: string
  params?: Record<string, number>
  fabricRules?: string[]
  note?: string
}

/**
 * #1113 Feature B — the categorized construction catalog the picker renders
 * (families + techniques with param defs, default fabric rules, presets). Served
 * verbatim from the canonical backend module, so the picker never hardcodes it.
 */
export const useConstructionTechniques = (
  id: string,
  options?: Omit<
    UseQueryOptions<ConstructionCatalog, FetchError>,
    "queryKey" | "queryFn"
  >
) => {
  return useQuery({
    queryKey: [...partnerDesignsQueryKeys.detail(id), "construction-techniques"],
    queryFn: async () =>
      sdk.client.fetch<ConstructionCatalog>(
        `/partners/designs/${id}/construction-techniques`,
        { method: "GET" }
      ),
    enabled: !!id,
    staleTime: Infinity, // static catalog
    ...options,
  })
}

/** #1113 Feature B — this design's authored construction details. */
export const useConstructionDetails = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      { construction_details: ConstructionDetailRecord[]; count: number },
      FetchError
    >,
    "queryKey" | "queryFn"
  >
) => {
  return useQuery({
    queryKey: [...partnerDesignsQueryKeys.detail(id), "construction-details"],
    queryFn: async () =>
      sdk.client.fetch<{
        construction_details: ConstructionDetailRecord[]
        count: number
      }>(`/partners/designs/${id}/construction-details`, { method: "GET" }),
    enabled: !!id,
    ...options,
  })
}

/** #1113 Feature B — add a construction detail (author-scoped). */
export const useCreateConstructionDetail = (
  id: string,
  options?: UseMutationOptions<
    { construction_detail: ConstructionDetailRecord },
    FetchError,
    CreateConstructionPayload
  >
) => {
  return useMutation({
    mutationFn: async (body: CreateConstructionPayload) =>
      sdk.client.fetch<{ construction_detail: ConstructionDetailRecord }>(
        `/partners/designs/${id}/construction-details`,
        { method: "POST", body }
      ),
    onSuccess: async (data, variables, context) => {
      // Refreshes the detail list, the block-availability list and the catalog.
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/** #1113 Feature B — remove a construction detail (author-scoped). */
export const useDeleteConstructionDetail = (
  id: string,
  options?: UseMutationOptions<{ id: string; deleted: boolean }, FetchError, string>
) => {
  return useMutation({
    mutationFn: async (detailId: string) =>
      sdk.client.fetch<{ id: string; deleted: boolean }>(
        `/partners/designs/${id}/construction-details/${detailId}`,
        { method: "DELETE" }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * #1113 — idempotent, brief-friendly seed: fills an EMPTY moodboard from the
 * brief so the designer opens onto an editable snapshot (Figma-style) without a
 * manual "Generate" click. No-throw: nothing to render yet, or a board that's
 * already populated → `{ moodboard: null }` (never clobbers).
 */
export const useSeedMoodboard = (
  id: string,
  options?: UseMutationOptions<{ moodboard: MoodboardScene | null }, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () => {
      return await sdk.client.fetch<{ moodboard: MoodboardScene | null }>(
        `/partners/designs/${id}/moodboard/seed`,
        { method: "POST" }
      )
    },
    onSuccess: async (data, variables, context) => {
      if (data?.moodboard) {
        await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.detail(id) })
      }
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * #1113 S3 — persist the moodboard scene the designer edited on the canvas.
 * Author-scoped route (owner OR assigned designer), so an invited stranger can
 * save without owning the design.
 */
export const useSaveMoodboard = (
  id: string,
  options?: UseMutationOptions<{ moodboard: MoodboardScene }, FetchError, MoodboardScene>
) => {
  return useMutation({
    mutationFn: async (moodboard) => {
      return await sdk.client.fetch<{ moodboard: MoodboardScene }>(
        `/partners/designs/${id}/moodboard`,
        { method: "PUT", body: { moodboard } }
      )
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: partnerDesignsQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/** #1113 S3 — the subset of brief columns the moodboard cards round-trip to. */
export type PartnerBriefUpdate = {
  concept_theme?: string | null
  aesthetic_keywords?: string[] | null
  persona?: Record<string, any> | null
  competitors?: Array<Record<string, any>> | null
  price_point?: "luxury" | "mid_market" | "budget" | null
  design_budget?: number | null
  cost_currency?: string | null
  milestones?: Array<{ label: string; date?: string | null }> | null
}

/**
 * #1113 S3 — partial brief update, driven by `brief-field` card edits on the
 * canvas. Author-scoped (owner OR assigned designer).
 */
export const useUpdatePartnerBrief = (
  id: string,
  options?: UseMutationOptions<{ brief: Record<string, any> }, FetchError, PartnerBriefUpdate>
) => {
  return useMutation({
    mutationFn: async (payload) => {
      return await sdk.client.fetch<{ brief: Record<string, any> }>(
        `/partners/designs/${id}/brief`,
        { method: "PUT", body: payload }
      )
    },
    onSuccess: async (data, variables, context) => {
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
