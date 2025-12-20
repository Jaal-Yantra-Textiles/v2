import { FetchError } from "@medusajs/js-sdk"
import { AdminUser, HttpTypes } from "@medusajs/types"
import {
    QueryKey,
    useMutation,
    UseMutationOptions,
    useQuery,
    useQueryClient,
    UseQueryOptions,
  } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

const USERS_QUERY_KEY = "users-from-admin" as const
const usersQueryKeys = {
  ...queryKeysFactory(USERS_QUERY_KEY),
  me: () => [USERS_QUERY_KEY, "me"],
}

export const useMe = (
  options?: Omit<
    UseQueryOptions<HttpTypes.AdminUserResponse, FetchError, HttpTypes.AdminUserResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.user.me() as any,
    queryKey: usersQueryKeys.me(),
    ...options,
  })

  return { ...data, ...rest }
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



export const useAdminSuspendUser = (
  id: string,
  options?: UseMutationOptions<AdminUser, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminUser>(`/admin/users/${id}/suspend`, {
        method: "POST",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.detail(id),
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
