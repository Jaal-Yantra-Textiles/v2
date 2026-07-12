import { toast } from "@medusajs/ui"
import {
  QueryKey,
  UseMutationResult,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

export type DeploymentProvider = "vercel" | "cloudflare" | "render" | "netlify"
export type DeploymentAccountStatus = "active" | "full" | "inactive"

export type AdminDeploymentAccount = {
  id: string
  provider: DeploymentProvider
  role: string
  label: string
  api_config: Record<string, any> & { token_present?: boolean }
  cutoff_max: number | null
  project_count: number
  priority: number
  status: DeploymentAccountStatus
  remaining_capacity: number | null
  created_at?: string
  updated_at?: string
}

export type AdminDeploymentAccountListResponse = {
  deployment_accounts: AdminDeploymentAccount[]
  count: number
  offset: number
  limit: number
}

export type AdminDeploymentAccountResponse = {
  deployment_account: AdminDeploymentAccount
}

export type CreateDeploymentAccountPayload = {
  provider: DeploymentProvider
  label: string
  token: string
  role?: string
  cutoff_max?: number | null
  priority?: number
  status?: DeploymentAccountStatus
  team_id?: string
  account_id?: string
  zone_id?: string
  github_installation_id?: string
  github_repo_id?: string
  owner_id?: string
  region?: string
  plan?: string
}

export type UpdateDeploymentAccountPayload = Partial<
  Omit<CreateDeploymentAccountPayload, "provider">
>

export const deploymentAccountsQueryKeys = queryKeysFactory<
  "deployment_accounts",
  CreateDeploymentAccountPayload | UpdateDeploymentAccountPayload
>("deployment_accounts")

export const useDeploymentAccounts = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminDeploymentAccountListResponse,
      FetchError,
      AdminDeploymentAccountListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: deploymentAccountsQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<AdminDeploymentAccountListResponse>(
        `/admin/deployment-accounts`,
        { method: "GET", query }
      ),
    ...options,
  })
  return { ...data, ...rest }
}

export const useCreateDeploymentAccount = (): UseMutationResult<
  AdminDeploymentAccountResponse,
  Error,
  CreateDeploymentAccountPayload
> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch(`/admin/deployment-accounts`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deploymentAccountsQueryKeys.lists() })
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to create hosting account")
    },
  })
}

export const useUpdateDeploymentAccount = (
  id: string
): UseMutationResult<AdminDeploymentAccountResponse, Error, UpdateDeploymentAccountPayload> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch(`/admin/deployment-accounts/${id}`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deploymentAccountsQueryKeys.all })
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to update hosting account")
    },
  })
}

export const useDeleteDeploymentAccount = (
  id: string
): UseMutationResult<{ id: string; deleted: boolean }, Error, void> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch(`/admin/deployment-accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deploymentAccountsQueryKeys.all })
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to delete hosting account")
    },
  })
}
