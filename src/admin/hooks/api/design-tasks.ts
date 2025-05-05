import { FetchError } from "@medusajs/js-sdk";
import { PaginatedResponse } from "@medusajs/types";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";
import { designQueryKeys } from "./designs";

// Types from validators
export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
export type DependencyType = "blocking" | "non_blocking" | "subtask" | "related";

export interface AdminDesignTask {
  id: string;
  design_id: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  status: TaskStatus;
  due_date?: Date;
  start_date?: Date;
  parent_task_id?: string;
  dependency_type?: DependencyType;
  template_names?: string[];
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
  subtasks?: AdminDesignTask[];
}

export interface ChildTask {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  dependency_type: DependencyType;
}

export interface CreateDesignTaskPayload {
  type: "template" | "task" | "multiple";
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date?: Date;
  template_names?: string[];
  parent_task_id?: string;
  child_tasks?: ChildTask[];
  metadata?: Record<string, any>;
  dependency_type?: DependencyType;
}

export interface UpdateDesignTaskPayload {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date?: Date;
  metadata?: Record<string, any>;
}

export interface AdminDesignTaskResponse {
  task: AdminDesignTask;
}

export interface AdminDesignTasksResponse {
  tasks: AdminDesignTask[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminDesignTasksQuery {
  offset?: number;
  limit?: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  template_names?: string[];
}

const DESIGN_TASKS_QUERY_KEY = "design-tasks" as const;
export const designTasksQueryKeys = queryKeysFactory(DESIGN_TASKS_QUERY_KEY);

export const useDesignTask = (
  designId: string,
  taskId: string,
  options?: Omit<
    UseQueryOptions<
      AdminDesignTaskResponse,
      FetchError,
      AdminDesignTaskResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: designTasksQueryKeys.detail(taskId),
    queryFn: async () =>
      sdk.client.fetch<AdminDesignTaskResponse>(
        `/admin/designs/${designId}/tasks/${taskId}`,
        {
          method: "GET",
        }
      ),
    ...options,
  });

  return { ...rest, task: data?.task };
};

export const useDesignTasks = (
  designId: string,
  query?: AdminDesignTasksQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminDesignTasksResponse>,
      FetchError,
      PaginatedResponse<AdminDesignTasksResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: designTasksQueryKeys.list(designId),
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminDesignTasksResponse>>(
        `/admin/designs/${designId}/tasks`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  });

  return { ...data, ...rest };
};

export const useCreateDesignTask = (
  designId: string,
  options?: UseMutationOptions<
    AdminDesignTaskResponse,
    FetchError,
    CreateDesignTaskPayload
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateDesignTaskPayload) =>
      sdk.client.fetch<AdminDesignTaskResponse>(
        `/admin/designs/${designId}/tasks`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designTasksQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useUpdateDesignTask = (
  designId: string,
  taskId: string,
  options?: UseMutationOptions<
    AdminDesignTaskResponse,
    FetchError,
    UpdateDesignTaskPayload
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateDesignTaskPayload) =>
      sdk.client.fetch<AdminDesignTaskResponse>(
        `/admin/designs/${designId}/tasks/${taskId}`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designTasksQueryKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: designTasksQueryKeys.lists() });
      
      // Also invalidate the design query to ensure design data is refreshed
      // when tasks are modified
      queryClient.invalidateQueries({ 
        queryKey: designQueryKeys.detail(designId)
      });
      
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useDeleteDesignTask = (
  designId: string,
  taskId: string,
  options?: UseMutationOptions<void, FetchError, void>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<void>(
        `/admin/designs/${designId}/tasks/${taskId}`,
        {
          method: "DELETE",
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designTasksQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
