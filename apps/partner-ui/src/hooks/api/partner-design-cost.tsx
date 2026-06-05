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
  cost_currency?: string | null
  cost_breakdown?: {
    items?: Array<Record<string, any>>
    production_percent?: number
    confidence?: string
    calculated_at?: string
    source?: string
  } | null
}

export type PartnerDesignCostEstimate = {
  cost_estimate: {
    material_cost: number
    production_cost: number
    total_estimated: number
    confidence: string
    breakdown?: {
      materials?: Array<Record<string, any>>
      production_percent?: number
    }
  }
  message: string
}

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
  options?: UseMutationOptions<PartnerDesignCostEstimate, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<PartnerDesignCostEstimate>(
        `/partners/designs/${designId}/recalculate-cost`,
        { method: "POST", body: {} }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: costKey(designId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
