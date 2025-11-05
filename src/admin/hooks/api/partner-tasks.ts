import { FetchError } from "@medusajs/js-sdk";
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

export type AdminPartnerTask = {
  id: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  end_date?: Date;
  start_date?: Date;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
};

export type CreatePartnerTaskPayload = {
  title: string;
  description?: string;
  priority: string;
  status: string;
  end_date?: Date;
  start_date?: Date;
  metadata?: Record<string, any>;
};

export type UpdatePartnerTaskPayload = Partial<CreatePartnerTaskPayload>;

export interface PartnerTaskResponse {
  task: AdminPartnerTask;
}

export interface PartnerTasksResponse {
  tasks: AdminPartnerTask[];
  count: number;
}

const PARTNER_TASKS_QUERY_KEY = "partner_tasks" as const;
export const partnerTasksQueryKeys = queryKeysFactory(PARTNER_TASKS_QUERY_KEY);

export const usePartnerTasks = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<PartnerTasksResponse, FetchError, PartnerTasksResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: [...partnerTasksQueryKeys.lists(), partnerId],
    queryFn: async () =>
      sdk.client.fetch<PartnerTasksResponse>(
        `/admin/partners/${partnerId}/tasks`,
        {
          method: "GET",
        }
      ),
    enabled: !!partnerId,
    ...options,
  });
  return { ...data, ...rest };
};

export const useCreatePartnerTask = (
  partnerId: string,
  options?: UseMutationOptions<
    PartnerTaskResponse,
    FetchError,
    CreatePartnerTaskPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<PartnerTaskResponse>(
        `/admin/partners/${partnerId}/tasks`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: partnerTasksQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["partners", partnerId] });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useAssignPartnerTask = (
  partnerId: string,
  options?: UseMutationOptions<
    PartnerTaskResponse,
    FetchError,
    { taskId: string }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId }) =>
      sdk.client.fetch<PartnerTaskResponse>(
        `/admin/partners/${partnerId}/tasks/${taskId}/assign`,
        {
          method: "POST",
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: partnerTasksQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["partners", partnerId] });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useUpdatePartnerTask = (
  partnerId: string,
  taskId: string,
  options?: UseMutationOptions<
    PartnerTaskResponse,
    FetchError,
    UpdatePartnerTaskPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<PartnerTaskResponse>(
        `/admin/partners/${partnerId}/tasks/${taskId}`,
        {
          method: "PATCH",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: partnerTasksQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["partners", partnerId] });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
