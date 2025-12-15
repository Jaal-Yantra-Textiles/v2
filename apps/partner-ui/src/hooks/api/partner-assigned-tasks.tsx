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
  completed_at?: string
  metadata?: Record<string, any>
  subtasks?: Array<Record<string, any>>
}

export type PartnerAssignedTasksListResponse = {
  tasks: PartnerAssignedTask[]
  count: number
}

export type PartnerAssignedTaskRetrieveResponse = {
  task: PartnerAssignedTask
}

export type PartnerAssignedTaskResponse = {
  task: PartnerAssignedTask
  message?: string
}

export type PartnerAssignedTaskSubtask = Record<string, any> & {
  id: string
  title?: string
  description?: string
  status?: string
  created_at?: string
  updated_at?: string
  completed_at?: string
  metadata?: Record<string, any>
}

export type PartnerAssignedTaskSubtasksListResponse = {
  subtasks: PartnerAssignedTaskSubtask[]
  count: number
}

export type PartnerAssignedTaskCompleteSubtaskResponse = {
  subtask: PartnerAssignedTaskSubtask | PartnerAssignedTaskSubtask[]
  parent_completed?: boolean
  message?: string
}

export type PartnerAssignedTaskComment = {
  id: string
  comment: string
  author_type: "partner" | "admin"
  author_id: string
  author_name: string
  created_at: string
}

export type PartnerAssignedTaskCommentsListResponse = {
  comments: PartnerAssignedTaskComment[]
  count: number
}

export type PartnerAssignedTaskAddCommentPayload = {
  comment: string
}

export type PartnerAssignedTaskAddCommentResponse = {
  message?: string
  comment: PartnerAssignedTaskComment
  task?: PartnerAssignedTask
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

export const usePartnerAssignedTask = (
  taskId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerAssignedTaskRetrieveResponse,
      FetchError,
      PartnerAssignedTaskRetrieveResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerAssignedTasksQueryKeys.detail(taskId),
    queryFn: async () =>
      sdk.client.fetch<PartnerAssignedTaskRetrieveResponse>(
        `/partners/assigned-tasks/${taskId}`,
        { method: "GET" }
      ),
    ...options,
  })

  return {
    ...data,
    task: data?.task,
    ...rest,
  }
}

export const partnerAssignedTaskSubtasksQueryKey = (taskId: string) =>
  [...partnerAssignedTasksQueryKeys.detail(taskId), "subtasks"] as const

export const usePartnerAssignedTaskSubtasks = (
  taskId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerAssignedTaskSubtasksListResponse,
      FetchError,
      PartnerAssignedTaskSubtasksListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerAssignedTaskSubtasksQueryKey(taskId),
    queryFn: async () =>
      sdk.client.fetch<PartnerAssignedTaskSubtasksListResponse>(
        `/partners/assigned-tasks/${taskId}/subtasks`,
        { method: "GET" }
      ),
    ...options,
  })

  return {
    ...data,
    subtasks: data?.subtasks ?? [],
    ...rest,
  }
}

export const useCompletePartnerAssignedTaskSubtask = (
  taskId: string,
  subtaskId: string,
  options?: UseMutationOptions<
    PartnerAssignedTaskCompleteSubtaskResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<PartnerAssignedTaskCompleteSubtaskResponse>(
        `/partners/assigned-tasks/${taskId}/subtasks/${subtaskId}/complete`,
        { method: "POST" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTaskSubtasksQueryKey(taskId),
      })
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTasksQueryKeys.detail(taskId),
      })
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTasksQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const partnerAssignedTaskCommentsQueryKey = (taskId: string) =>
  [...partnerAssignedTasksQueryKeys.detail(taskId), "comments"] as const

export const usePartnerAssignedTaskComments = (
  taskId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerAssignedTaskCommentsListResponse,
      FetchError,
      PartnerAssignedTaskCommentsListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerAssignedTaskCommentsQueryKey(taskId),
    queryFn: async () =>
      sdk.client.fetch<PartnerAssignedTaskCommentsListResponse>(
        `/partners/assigned-tasks/${taskId}/comments`,
        { method: "GET" }
      ),
    ...options,
  })

  return {
    ...data,
    comments: data?.comments ?? [],
    ...rest,
  }
}

export const useAddPartnerAssignedTaskComment = (
  taskId: string,
  options?: UseMutationOptions<
    PartnerAssignedTaskAddCommentResponse,
    FetchError,
    PartnerAssignedTaskAddCommentPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<PartnerAssignedTaskAddCommentResponse>(
        `/partners/assigned-tasks/${taskId}/comments`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTaskCommentsQueryKey(taskId),
      })
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTasksQueryKeys.detail(taskId),
      })
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTasksQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
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
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTasksQueryKeys.detail(taskId),
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
      queryClient.invalidateQueries({
        queryKey: partnerAssignedTasksQueryKeys.detail(taskId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
