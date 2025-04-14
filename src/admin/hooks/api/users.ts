import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import {
    QueryKey,
    useQuery,
    UseQueryOptions,
  } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

const USERS_QUERY_KEY = "users-from-admin" as const
const usersQueryKeys = {
  ...queryKeysFactory(USERS_QUERY_KEY),
  me: () => [USERS_QUERY_KEY, "me"],
}

export const useUsers = (
    query?: HttpTypes.AdminUserListParams,
    options?: Omit<
      UseQueryOptions<
        HttpTypes.AdminUserListResponse,
        FetchError,
        HttpTypes.AdminUserListResponse,
        QueryKey
      >,
      "queryFn" | "queryKey"
    >
  ) => {
    const { data, ...rest } = useQuery({
      queryFn: () => sdk.admin.user.list(query),
      queryKey: usersQueryKeys.list(query),
      ...options,
    })
  
    return { ...data, ...rest }
  }