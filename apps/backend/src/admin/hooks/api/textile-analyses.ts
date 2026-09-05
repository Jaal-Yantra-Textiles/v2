import {
  QueryKey,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"
import { sdk } from "../../lib/config"

export type AdminTextileAnalysis = {
  id: string
  source: string
  model_name?: string | null
  confidence?: number | null
  cloth_type?: string | null
  category?: string | null
  pattern?: string | null
  fabric_weight?: string | null
  weave_or_knit?: string | null
  primary_color?: string | null
  title?: string | null
  description?: string | null
  colors?: string[] | null
  season?: string[] | null
  occasion?: string[] | null
  care_instructions?: string[] | null
  target_audience?: string | null
  analyzed_at?: string | null
  media?: {
    id: string
    file_name: string
    file_path: string
    title?: string | null
  } | null
}

export type AdminTextileAnalysisListResponse = {
  textile_analyses: AdminTextileAnalysis[]
  count: number
}

export type AdminTextileAnalysisResponse = {
  textile_analysis: AdminTextileAnalysis
}

export type AdminTextileAnalysesQuery = {
  media_id?: string
  limit?: number
  offset?: number
}

export type AdminUpdateTextileAnalysis = {
  source?: string
  confidence?: number | null
  cloth_type?: string | null
  category?: string | null
  pattern?: string | null
  fabric_weight?: string | null
  weave_or_knit?: string | null
  primary_color?: string | null
  title?: string | null
  description?: string | null
  target_audience?: string | null
  colors?: string[] | null
  season?: string[] | null
  occasion?: string[] | null
  care_instructions?: string[] | null
}

/**
 * List textile analyses, optionally scoped to a single media file
 * (`media_id`). Used by the folder gallery to show "what the model saw" for the
 * current photo, and by the textile library page.
 */
export const useTextileAnalyses = (
  query?: AdminTextileAnalysesQuery,
  options?: Omit<
    UseQueryOptions<
      AdminTextileAnalysisListResponse,
      FetchError,
      AdminTextileAnalysisListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  return useQuery({
    queryKey: ["textile-analyses", query ?? {}],
    queryFn: () =>
      sdk.client.fetch<AdminTextileAnalysisListResponse>(
        "/admin/textile-analyses",
        { method: "GET", query: query ?? {} }
      ),
    ...options,
  })
}

/**
 * Fetch a single analysis, hydrated with its media file. Used by the edit
 * modal at `/textile-analyses/:id`.
 */
export const useTextileAnalysis = (
  id?: string,
  options?: Omit<
    UseQueryOptions<
      AdminTextileAnalysis,
      FetchError,
      AdminTextileAnalysis,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  return useQuery({
    queryKey: ["textile-analysis", id],
    queryFn: async () => {
      const res = await sdk.client.fetch<AdminTextileAnalysisResponse>(
        `/admin/textile-analyses/${id}`
      )
      return res.textile_analysis
    },
    enabled: !!id,
    ...options,
  })
}

/**
 * Correct a single analysis. Invalidates both the list and the single row so
 * the library grid reflects the edit when the modal closes.
 */
export const useUpdateTextileAnalysis = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string } & AdminUpdateTextileAnalysis) => {
      const res = await sdk.client.fetch<AdminTextileAnalysisResponse>(
        `/admin/textile-analyses/${id}`,
        { method: "PATCH", body: data }
      )
      return res.textile_analysis
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["textile-analyses"] })
      queryClient.invalidateQueries({ queryKey: ["textile-analysis", updated.id] })
    },
  })
}