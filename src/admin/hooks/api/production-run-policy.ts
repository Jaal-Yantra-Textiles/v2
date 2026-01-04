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

export type AdminProductionRunPolicyResponse = {
  policy: AdminProductionRunPolicy
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
