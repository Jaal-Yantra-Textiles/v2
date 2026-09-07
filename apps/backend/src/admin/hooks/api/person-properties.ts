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

export type SocialMediaEntry = {
  platform: string
  handle?: string
  url?: string
}

export type CorrectionEntry = {
  field: string
  note?: string
  corrected_value?: unknown
  corrected_at?: string
  corrected_by?: string
}

export type WeaverProperty = {
  id: string
  profile_type?: string
  census_id?: string | null
  relation_to_head?: string | null
  gender?: string | null
  social_group?: string | null
  religion?: string | null
  region_state?: string | null
  district?: string | null
  own_looms?: boolean | null
  total_looms_owned?: number | null
  natural_dye_used?: boolean | null
  sells_local_market?: boolean | null
  sells_master_weaver?: boolean | null
  sells_cooperative?: boolean | null
  sells_ecommerce?: boolean | null
  support_requirements?: string[] | null
  social_media?: SocialMediaEntry[] | null
  corrections?: CorrectionEntry[] | null
  custom_fields?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

export type WeaverPropertyUpsert = Partial<
  Pick<
    WeaverProperty,
    | "social_media"
    | "corrections"
    | "custom_fields"
    | "support_requirements"
    | "own_looms"
    | "total_looms_owned"
    | "natural_dye_used"
    | "sells_local_market"
    | "sells_master_weaver"
    | "sells_cooperative"
    | "sells_ecommerce"
    | "gender"
    | "social_group"
    | "religion"
    | "district"
    | "region_state"
  >
>

const PROPERTY_QUERY_KEY = ["person_properties", "by_census"] as const

export const useWeaverProperty = (
  censusId: string | number | undefined,
  options?: Omit<
    UseQueryOptions<{ person_property: WeaverProperty | null }, FetchError, { person_property: WeaverProperty | null }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  return useQuery({
    queryKey: [...PROPERTY_QUERY_KEY, censusId],
    queryFn: async () =>
      sdk.client.fetch<{ person_property: WeaverProperty | null }>(
        `/admin/person-properties/by-census/${censusId}`
      ),
    enabled: censusId !== undefined && censusId !== null && censusId !== "",
    ...options,
  })
}

export const useUpdateWeaverProperty = (
  censusId: string | number | undefined,
  options?: UseMutationOptions<{ person_property: WeaverProperty }, FetchError, WeaverPropertyUpsert>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: WeaverPropertyUpsert) =>
      sdk.client.fetch<{ person_property: WeaverProperty }>(
        `/admin/person-properties/by-census/${censusId}`,
        { method: "POST", body: payload }
      ),
    /*
     * 🔴 `...options` goes BEFORE `onSuccess`, never after. Spread last it
     * overwrites this handler with the caller's, the invalidation never runs,
     * and the save works while the screen stays stale until a hard refresh —
     * the defect that was live in 165 admin hooks (#1800).
     */
    ...options,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: [...PROPERTY_QUERY_KEY, censusId] })
      /*
       * 🔴 And the census weaver too. `GET /admin/census/weavers/:id` overlays
       * these corrections at read time, so it — not this query — is what shows
       * the corrected value. Invalidating only the property left the very view
       * the correction was written for displaying the old figure.
       */
      queryClient.invalidateQueries({ queryKey: ["census", "weaver", censusId] })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
  })
}