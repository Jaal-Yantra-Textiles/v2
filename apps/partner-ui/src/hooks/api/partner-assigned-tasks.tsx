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
import { queryKeysFactory } from "../../lib/query-key-factory"

const PARTNER_ASSIGNED_TASKS_QUERY_KEY = "partner-assigned-tasks" as const
export const partnerAssignedTasksQueryKeys = queryKeysFactory(
  PARTNER_ASSIGNED_TASKS_QUERY_KEY
)

export type PartnerAssignedTask = Record<string, any> & {
  id: string
  title?: string
  description?: string
  priority?: string
  status?: string
  created_at?: string
  updated_at?: string
  subtasks?: Array<Record<string, any>>
}

export type PartnerAssignedTasksListResponse = {
  tasks: PartnerAssignedTask[]
  count: number
}

export type PartnerAssignedTaskResponse = {
  task: PartnerAssignedTask
  message?: string
}

export const usePartnerAssignedTasks = (
  options?: Omit<
    UseQueryOptions<
      PartnerAssignedTasksListResponse,
      FetchError,
      PartnerAssignedTasksListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerAssignedTasksQueryKeys.lists(),
    queryFn: async () =>
      sdk.client.fetch<PartnerAssignedTasksListResponse>(
        `/partners/assigned-tasks`,
        { method: "GET" }
      ),
    ...options,
  })

  return {
    ...data,
    tasks: data?.tasks ?? [],
    ...rest,
  }
}

export const useAcceptPartnerAssignedTask = (
  taskId: string,
  options?: UseMutationOptions<PartnerAssignedTaskResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<PartnerAssignedTaskResponse>(
        `/partners/assigned-tasks/${taskId}/accept`,
        { method: "POST" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTasksQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useFinishPartnerAssignedTask = (
  taskId: string,
  options?: UseMutationOptions<PartnerAssignedTaskResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<PartnerAssignedTaskResponse>(
        `/partners/assigned-tasks/${taskId}/finish`,
        { method: "POST" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTasksQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
