import { FetchError } from "@medusajs/js-sdk";
import { QueryKey, UseMutationOptions, UseQueryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

export interface RequiredField {
  type: "string" | "enum" | "text" | "url";
  required: boolean;
  options?: string[];
}

export interface TaskCategory {
  id?: string;
  name?: string;
  description?: string;
}

export interface AdminTaskTemplate {
  id?: string;
  name: string;
  description?: string;
  priority: "low" | "medium" | "high";
  estimated_duration: number;
  required_fields: Record<string, RequiredField>;
  eventable: boolean;
  notifiable: boolean;
  message_template: string;
  metadata?: Record<string, any> | null | undefined;
  category?: string;
  category_id?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface CreateAdminTaskTemplatePayload {
  name: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  estimated_duration?: number;
  required_fields?: Record<string, RequiredField>;
  eventable?: boolean;
  notifiable?: boolean;
  message_template?: string;
  metadata?: Record<string, any> | null | undefined;
  category?: string;
  category_id?: string;
}
export type UpdateAdminTaskTemplatePayload = Partial<CreateAdminTaskTemplatePayload>;

export interface AdminTaskTemplateResponse {
  task_template: AdminTaskTemplate;
}

export interface AdminTaskTemplatesResponse {
  task_templates: AdminTaskTemplate[];
  count: number;
  offset: number;
  limit: number;
}

const TASK_TEMPLATE_QUERY_KEY = "task-templates" as const;
export const taskTemplateQueryKeys = queryKeysFactory(TASK_TEMPLATE_QUERY_KEY);

export const useTaskTemplate = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminTaskTemplateResponse,
      FetchError,
      AdminTaskTemplateResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: taskTemplateQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<AdminTaskTemplateResponse>(
        `/admin/task-templates/${id}`,
        {
          method: "GET",
          query,
        },
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const useTaskTemplates = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminTaskTemplatesResponse,
      FetchError,
      AdminTaskTemplatesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: taskTemplateQueryKeys.lists(),
    queryFn: async () =>
      sdk.client.fetch<AdminTaskTemplatesResponse>(
        `/admin/task-templates`,
        {
          method: "GET",
          query,
        },
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const useCreateTaskTemplate = (
  options?: UseMutationOptions<
    AdminTaskTemplateResponse,
    FetchError,
    CreateAdminTaskTemplatePayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateAdminTaskTemplatePayload) =>
      sdk.client.fetch<AdminTaskTemplateResponse>(`/admin/task-templates`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: taskTemplateQueryKeys.lists() });
      if (options?.onSuccess) {
        options.onSuccess(data, variables, context);
      }
    },
    ...options,
  });
};

export const useUpdateTaskTemplate = (
  id: string,
  options?: UseMutationOptions<
    AdminTaskTemplateResponse,
    FetchError,
    UpdateAdminTaskTemplatePayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateAdminTaskTemplatePayload) =>
      sdk.client.fetch<AdminTaskTemplateResponse>(`/admin/task-templates/${id}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: taskTemplateQueryKeys.detail(id)});
      if (options?.onSuccess) {
        options.onSuccess(data, variables, context);
      }
    },
    ...options,
  });
};

export const useDeleteTaskTemplate = (
  id: string,
  options?: UseMutationOptions<AdminTaskTemplate, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminTaskTemplate>(`/admin/task-templates/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: taskTemplateQueryKeys.lists()});
      if (options?.onSuccess) {
        options.onSuccess(data, variables, context);
      }
    },
    ...options,
  });
};
