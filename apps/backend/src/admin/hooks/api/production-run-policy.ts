import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

export type AdminProductionRunPolicy = {
  id: string
  key: string
  config: Record<string, any> | null
  metadata?: Record<string, any> | null
  created_at: Date
  updated_at: Date
  deleted_at?: Date | null
}

/** Which parts of the policy are in force but absent from the stored row. */
export type AdminProductionRunPolicyMissing = {
  transitions: string[]
  sections: string[]
}

export type AdminProductionRunPolicyResponse = {
  policy: AdminProductionRunPolicy
  /** Defaults with the stored row layered on top — what actually governs
   *  transitions. The stored `policy.config` can be a strict subset. */
  effective_config: Record<string, any>
  missing: AdminProductionRunPolicyMissing
}

export type AdminUpdateProductionRunPolicyPayload = {
  config: Record<string, any> | null
}

const PRODUCTION_RUN_POLICY_QUERY_KEY = "production_run_policy" as const
export const productionRunPolicyQueryKeys = queryKeysFactory(
  PRODUCTION_RUN_POLICY_QUERY_KEY
)

export const useProductionRunPolicy = () => {
  const { data, ...rest } = useQuery({
    queryKey: productionRunPolicyQueryKeys.detail("default"),
    queryFn: async () =>
      sdk.client.fetch<AdminProductionRunPolicyResponse>(
        "/admin/production-run-policy",
        {
          method: "GET",
        }
      ),
  })

  return {
    ...rest,
    policy: data?.policy,
    effectiveConfig: data?.effective_config,
    missing: data?.missing,
  }
}

export const useUpdateProductionRunPolicy = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminUpdateProductionRunPolicyPayload) =>
      sdk.client.fetch<AdminProductionRunPolicyResponse>(
        "/admin/production-run-policy",
        {
          method: "PUT",
          body: payload,
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productionRunPolicyQueryKeys.detail("default"),
      })
    },
  })
}
