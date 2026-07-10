import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory, TQueryKey } from "../../lib/query-key-factory"

const RBAC_ROLES_QUERY_KEY = "rbac_roles" as const
const _rbacRolesQueryKeys = queryKeysFactory(
  RBAC_ROLES_QUERY_KEY
) as TQueryKey<"rbac_roles"> & {
  policies: (roleId: string, query?: any) => any[]
  users: (roleId: string, query?: any) => any[]
}

_rbacRolesQueryKeys.policies = function (roleId: string, query?: any) {
  return [this.detail(roleId), "policies", query].filter(Boolean)
}

_rbacRolesQueryKeys.users = function (roleId: string, query?: any) {
  return [this.detail(roleId), "users", query].filter(Boolean)
}

export const rbacRolesQueryKeys = _rbacRolesQueryKeys

export const useRbacRole = (
  id: string,
  query?: HttpTypes.AdminRbacRoleParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminRbacRoleResponse,
      FetchError,
      HttpTypes.AdminRbacRoleResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.retrieve) — avoids 401→logout
    queryFn: async () =>
      ({} as unknown as HttpTypes.AdminRbacRoleResponse),
    queryKey: rbacRolesQueryKeys.detail(id, query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useRbacRoles = (
  query?: HttpTypes.AdminRbacRoleListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminRbacRoleListResponse,
      FetchError,
      HttpTypes.AdminRbacRoleListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.list) — avoids 401→logout
    queryFn: async () =>
      ({
        rbac_roles: [],
        count: 0,
        offset: 0,
        limit: 0,
      } as unknown as HttpTypes.AdminRbacRoleListResponse),
    queryKey: rbacRolesQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useRbacRolePolicies = (
  roleId: string,
  query?: HttpTypes.AdminRbacPolicyListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminRbacPolicyListResponse,
      FetchError,
      HttpTypes.AdminRbacPolicyListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.listPolicies) — avoids 401→logout
    queryFn: async () =>
      ({
        rbac_policies: [],
        count: 0,
        offset: 0,
        limit: 0,
      } as unknown as HttpTypes.AdminRbacPolicyListResponse),
    queryKey: rbacRolesQueryKeys.policies(roleId, query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useRbacRoleUsers = (
  roleId: string,
  query?: HttpTypes.AdminRbacRoleUserListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminRbacRoleUserListResponse,
      FetchError,
      HttpTypes.AdminRbacRoleUserListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.listUsers) — avoids 401→logout
    queryFn: async () =>
      ({
        users: [],
        count: 0,
        offset: 0,
        limit: 0,
      } as unknown as HttpTypes.AdminRbacRoleUserListResponse),
    queryKey: rbacRolesQueryKeys.users(roleId, query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateRbacRole = (
  options?: UseMutationOptions<
    HttpTypes.AdminRbacRoleResponse,
    FetchError,
    HttpTypes.AdminCreateRbacRole
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.create) — avoids 401→logout
    mutationFn: async () => ({} as unknown as HttpTypes.AdminRbacRoleResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateRbacRole = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminRbacRoleResponse,
    FetchError,
    HttpTypes.AdminUpdateRbacRole
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.update) — avoids 401→logout
    mutationFn: async () => ({} as unknown as HttpTypes.AdminRbacRoleResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.detail(id) })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteRbacRole = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminRbacRoleDeleteResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.delete) — avoids 401→logout
    mutationFn: async () =>
      ({} as unknown as HttpTypes.AdminRbacRoleDeleteResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.detail(id) })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteRbacRoleLazy = (
  options?: UseMutationOptions<
    HttpTypes.AdminRbacRoleDeleteResponse,
    FetchError,
    string
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.delete) — avoids 401→logout
    mutationFn: async () =>
      ({} as unknown as HttpTypes.AdminRbacRoleDeleteResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.details() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAddRbacRolePolicies = (
  roleId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminRbacPolicyListResponse,
    FetchError,
    HttpTypes.AdminAddRolePolicies
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.addPolicies) — avoids 401→logout
    mutationFn: async () =>
      ({} as unknown as HttpTypes.AdminRbacPolicyListResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.policies(roleId),
      })
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.detail(roleId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAddRbacRolePoliciesById = (
  options?: UseMutationOptions<
    HttpTypes.AdminRbacPolicyListResponse,
    FetchError,
    { roleId: string; policies: string[] }
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.addPolicies) — avoids 401→logout
    mutationFn: async () =>
      ({} as unknown as HttpTypes.AdminRbacPolicyListResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.policies(variables.roleId),
      })
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.detail(variables.roleId),
      })
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useRemoveRbacRolePolicy = (
  roleId: string,
  _policyId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminRbacPolicyDeleteResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.removePolicy) — avoids 401→logout
    mutationFn: async () =>
      ({} as unknown as HttpTypes.AdminRbacPolicyDeleteResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.policies(roleId),
      })
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.detail(roleId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAddRbacRoleUsers = (
  roleId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminRbacRoleUsersResponse,
    FetchError,
    HttpTypes.AdminAssignRoleUsers["users"]
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.addUsers) — avoids 401→logout
    mutationFn: async () =>
      ({} as unknown as HttpTypes.AdminRbacRoleUsersResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.users(roleId),
      })
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.detail(roleId),
      })
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useRemoveRbacRoleUsers = (
  roleId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminRbacRoleUsersDeleteResponse,
    FetchError,
    HttpTypes.AdminRemoveRoleUsers["users"]
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.removeUsers) — avoids 401→logout
    mutationFn: async () =>
      ({} as unknown as HttpTypes.AdminRbacRoleUsersDeleteResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.users(roleId),
      })
      queryClient.invalidateQueries({
        queryKey: rbacRolesQueryKeys.detail(roleId),
      })
      queryClient.invalidateQueries({ queryKey: rbacRolesQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

const ME_PERMISSIONS_QUERY_KEY = ["me-permissions"] as const

export const mePermissionsQueryKey = ME_PERMISSIONS_QUERY_KEY

/**
 * Fetches the authenticated actor's resolved permission set. The response is always a flat list of `resource:operation` strings.
 */
export const useMePermissions = (
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminRbacMePermissionsResponse,
      FetchError,
      HttpTypes.AdminRbacMePermissionsResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  return useQuery({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.mePermissions) — avoids 401→logout
    queryFn: async () =>
      ({} as unknown as HttpTypes.AdminRbacMePermissionsResponse),
    queryKey: mePermissionsQueryKey,
    staleTime: 5 * 60 * 1000,
    ...options,
  })
}

const ASSIGNABLE_ROLES_QUERY_KEY = ["rbac_assignable_roles"] as const

export const assignableRolesQueryKey = ASSIGNABLE_ROLES_QUERY_KEY

/**
 * Fetches the roles the authenticated actor is allowed to assign.
 */
export const useRbacAssignableRoles = (
  query?: HttpTypes.AdminRbacRoleListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminRbacAssignableRolesListResponse,
      FetchError,
      HttpTypes.AdminRbacAssignableRolesListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  return useQuery({
    // investor-ui: admin API disabled (was sdk.admin.rbacRole.listAssignable) — avoids 401→logout
    queryFn: async () =>
      ({
        rbac_roles: [],
        count: 0,
        offset: 0,
        limit: 0,
      } as unknown as HttpTypes.AdminRbacAssignableRolesListResponse),
    queryKey: [...ASSIGNABLE_ROLES_QUERY_KEY, query],
    staleTime: 5 * 60 * 1000,
    ...options,
  })
}
