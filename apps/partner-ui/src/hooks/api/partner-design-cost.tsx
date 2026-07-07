import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"

/**
 * Roadmap #6 Phase 3 — partner design cost estimation.
 * GET /partners/designs/:id/cost + POST .../recalculate-cost.
 */

export type PartnerDesignCost = {
  design_id: string
  estimated_cost?: number | null
  material_cost?: number | null
  production_cost?: number | null
  /** JYT platform commission (10% of material). */
  platform_fee?: number | null
  cost_currency?: string | null
  cost_breakdown?: {
    items?: Array<Record<string, any>>
    production_percent?: number
    platform_fee?: number
    platform_fee_percent?: number
    /** "partner_entered" when the owner typed the production cost, else "estimated". */
    production_cost_source?: string
    confidence?: string
    calculated_at?: string
    source?: string
  } | null
}

export type PartnerDesignCostEstimate = {
  cost_estimate: {
    material_cost: number
    production_cost: number
    platform_fee: number
    total_estimated: number
    confidence: string
    breakdown?: {
      materials?: Array<Record<string, any>>
      production_percent?: number
      platform_fee_percent?: number
    }
  }
  message: string
}

/** Optional per-unit production cost the partner types; overrides the estimate. */
export type RecalcPartnerCostVars = { production_cost?: number } | void

const costKey = (designId: string) => ["partner-design-cost", designId]

export const usePartnerDesignCost = (
  designId: string,
  options?: Omit<
    UseQueryOptions<PartnerDesignCost, FetchError, PartnerDesignCost, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: costKey(designId),
    queryFn: async () =>
      sdk.client.fetch<PartnerDesignCost>(
        `/partners/designs/${designId}/cost`,
        { method: "GET" }
      ),
    ...options,
  })
  return { cost: data, ...rest }
}

export const useRecalculatePartnerDesignCost = (
  designId: string,
  options?: UseMutationOptions<
    PartnerDesignCostEstimate,
    FetchError,
    RecalcPartnerCostVars
  >
) => {
  return useMutation({
    mutationFn: async (vars?: RecalcPartnerCostVars) => {
      const body =
        vars && "production_cost" in vars && vars.production_cost != null
          ? { production_cost: vars.production_cost }
          : {}
      return sdk.client.fetch<PartnerDesignCostEstimate>(
        `/partners/designs/${designId}/recalculate-cost`,
        { method: "POST", body }
      )
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: costKey(designId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
