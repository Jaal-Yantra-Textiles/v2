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

export type AdminEmailTemplate = {
  id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
  [key: string]: any;
};

export type CreateAdminEmailTemplatePayload = {
  [key: string]: any;
};

export type CreateAdminEmailTemplatesPayload = {
  emailTemplates: CreateAdminEmailTemplatePayload[];
};

export type CreateEmailTemplatesPayload = CreateAdminEmailTemplatePayload | CreateAdminEmailTemplatesPayload;

export type UpdateAdminEmailTemplatePayload = Partial<CreateAdminEmailTemplatePayload>;

export interface AdminEmailTemplateResponse {
  emailTemplate: AdminEmailTemplate;
}

export interface AdminEmailTemplatesResponse {
  emailTemplates: AdminEmailTemplate[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminEmailTemplatesQuery {
  q?: string;
  offset?: number;
  limit?: number;
  [key: string]: any;
}

const EMAILTEMPLATE_QUERY_KEY = "email-templates" as const;
export const emailTemplatesQueryKeys = queryKeysFactory(EMAILTEMPLATE_QUERY_KEY);

export const useEmailTemplate = (
  emailTemplateId: string,
  options?: Omit<
    UseQueryOptions<AdminEmailTemplateResponse, FetchError, AdminEmailTemplateResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: emailTemplatesQueryKeys.detail(emailTemplateId),
    queryFn: async () =>
      sdk.client.fetch<AdminEmailTemplateResponse>(
        `/admin/email-templates/{emailTemplateId}`.replace('{emailTemplateId}', `${emailTemplateId}`),
        {
          method: "GET",
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const useEmailTemplates = (
  query?: AdminEmailTemplatesQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminEmailTemplatesResponse>,
      FetchError,
      PaginatedResponse<AdminEmailTemplatesResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: emailTemplatesQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminEmailTemplatesResponse>>(
        `/admin/email-templates`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const useCreateEmailTemplates = (
  options?: UseMutationOptions<
    AdminEmailTemplateResponse,
    FetchError,
    CreateEmailTemplatesPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<AdminEmailTemplateResponse>(
        `/admin/email-templates`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: emailTemplatesQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useUpdateEmailTemplate = (
  emailTemplateId: string,
  options?: UseMutationOptions<
    AdminEmailTemplateResponse,
    FetchError,
    UpdateAdminEmailTemplatePayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<AdminEmailTemplateResponse>(
        `/admin/email-templates/{emailTemplateId}`.replace('{emailTemplateId}', `${emailTemplateId}`),
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: emailTemplatesQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: emailTemplatesQueryKeys.detail(emailTemplateId) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useDeleteEmailTemplate = (
  emailTemplateId: string,
  options?: UseMutationOptions<AdminEmailTemplate, FetchError, void>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminEmailTemplate>(
        `/admin/email-templates/{emailTemplateId}`.replace('{emailTemplateId}', `${emailTemplateId}`),
        {
          method: "DELETE",
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: emailTemplatesQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: emailTemplatesQueryKeys.detail(emailTemplateId) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};