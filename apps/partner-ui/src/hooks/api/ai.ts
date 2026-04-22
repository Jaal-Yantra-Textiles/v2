import { FetchError } from "@medusajs/js-sdk"
import {
  useMutation,
  UseMutationOptions,
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

export type DescribeImagePayload = {
  imageUrl: string
  hint?: string
}

export type AiQuotaInfo = {
  used: number
  limit: number
  allowed: boolean
}

export type DescribeImageResponse = {
  title: string
  description: string
  usage?: { used: number; limit: number }
}

export type AiUsageResponse = {
  image_describe: AiQuotaInfo
}

/**
 * Upgrade-required FetchError shape (HTTP 402). Check `.status === 402`
 * and `(error as any).upgrade_required === true` to route the partner
 * toward the plans page.
 */
export type AiQuotaExhaustedError = FetchError & {
  status: 402
  upgrade_required: true
  used: number
  limit: number
  code: "ai_quota_exhausted"
}

const AI_QUERY_KEY = "ai" as const
export const aiQueryKeys = queryKeysFactory(AI_QUERY_KEY)

export const useAiUsage = (
  options?: Omit<
    UseQueryOptions<AiUsageResponse, FetchError, AiUsageResponse>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: aiQueryKeys.detail("usage"),
    queryFn: () =>
      sdk.client.fetch<AiUsageResponse>("/partners/ai/usage", {
        method: "GET",
      }),
    ...options,
  })
  return { ...data, ...rest }
}

export const useDescribeImage = (
  options?: UseMutationOptions<
    DescribeImageResponse,
    FetchError,
    DescribeImagePayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<DescribeImageResponse>(
        "/partners/ai/describe-image",
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      // Bump the cached usage counter so the next poll isn't needed.
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.detail("usage") })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
