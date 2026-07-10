import {
  MutationOptions,
  QueryKey,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const STORE_QUERY_KEY = "store" as const
export const storeQueryKeys = queryKeysFactory(STORE_QUERY_KEY)

/**
 * Investor UI has no admin `store` access. Calling `sdk.admin.store.list` here
 * returns 401 → the JS SDK clears the shared JWT (`investor_ui_auth_token`) →
 * the next `/investors/me` is unauthenticated → ProtectedRoute logs the
 * investor out. Since `useStore` runs on every shell mount, that 401 was the
 * root cause of the "logged in then bounced to /login" loop. We return a
 * static shell store instead of touching the admin API.
 */
export async function retrieveActiveStore(
  _query?: HttpTypes.AdminStoreParams
): Promise<HttpTypes.AdminStoreResponse> {
  return {
    store: {
      id: "investor_portal",
      name: "Investor Portal",
    },
  } as unknown as HttpTypes.AdminStoreResponse
}

export const useStore = (
  query?: HttpTypes.SelectParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminStoreResponse,
      FetchError,
      HttpTypes.AdminStoreResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => retrieveActiveStore(query),
    queryKey: storeQueryKeys.details(),
    ...options,
  })

  return {
    ...data,
    ...rest,
  }
}

export const useUpdateStore = (
  _id: string,
  options?: MutationOptions<
    HttpTypes.AdminStoreResponse,
    FetchError,
    HttpTypes.AdminUpdateStore
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.store.update) — avoids 401→logout
    mutationFn: async () => ({} as unknown as HttpTypes.AdminStoreResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: storeQueryKeys.details() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
