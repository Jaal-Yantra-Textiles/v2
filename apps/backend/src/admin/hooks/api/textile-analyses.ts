import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"
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

export type AdminTextileAnalysesQuery = {
  media_id?: string
  limit?: number
  offset?: number
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