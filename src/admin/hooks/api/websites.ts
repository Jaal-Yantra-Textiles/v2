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
import { WebsiteSchema, UpdateWebsiteSchema } from "../../../api/admin/websites/validators";
import { Block } from "./pages";


type Pages= [ {
  id: string,
  title: string,
  slug: string, 
  content: string,
  page_type: "Home" | "About" | "Contact" | "Blog" | "Product" | "Service" | "Portfolio" | "Landing" | "Custom";
  status: "Draft" | "Published" | "Archived";
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  published_at?: string;
  metadata?: Record<string, unknown>;
  blocks?: Block[];
  created_at: Date;
  updated_at: Date;
}]

export type AdminWebsite = WebsiteSchema & {
  id: string;
  pages: Pages
  created_at: Date;
  updated_at: Date;
};

export type CreateAdminWebsitePayload = WebsiteSchema;
export type UpdateAdminWebsitePayload = UpdateWebsiteSchema;

export interface AdminWebsiteResponse {
  website: AdminWebsite;
}

export interface AdminWebsitesResponse {
  websites: AdminWebsite[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminWebsitesQuery {
  q?: string | undefined;
  offset?: number;
  limit?: number;
  domain?: string;
  name?: string;
  status?: AdminWebsite["status"];
}

const WEBSITE_QUERY_KEY = "websites" as const;
export const websiteQueryKeys = queryKeysFactory(WEBSITE_QUERY_KEY);

export const useWebsite = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminWebsiteResponse,
      FetchError,
      AdminWebsiteResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: websiteQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<AdminWebsiteResponse>(`/admin/websites/${id}`, {
        method: "GET",
        query,
      }),
      
    ...options,
  });
  return { ...data, ...rest };
};

export const useWebsites = (
  query?: AdminWebsitesQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminWebsitesResponse>,
      FetchError,
      PaginatedResponse<AdminWebsitesResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminWebsitesResponse>>(
        `/admin/websites`,
        {
          method: "GET",
          query,
        },
      ),
    queryKey: websiteQueryKeys.list(query),
    ...options,
  });
  return { ...data, ...rest };
};

export const useCreateWebsite = (
  options?: UseMutationOptions<
    AdminWebsiteResponse,
    FetchError,
    CreateAdminWebsitePayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateAdminWebsitePayload) =>
      sdk.client.fetch<AdminWebsiteResponse>(`/admin/websites`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useUpdateWebsite = (
  id: string,
  options?: UseMutationOptions<
    AdminWebsiteResponse,
    FetchError,
    UpdateAdminWebsitePayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateAdminWebsitePayload) =>
      sdk.client.fetch<AdminWebsiteResponse>(`/admin/websites/${id}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useDeleteWebsite = (
  id: string,
  options?: UseMutationOptions<AdminWebsite, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminWebsite>(`/admin/websites/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: websiteQueryKeys.detail(id),
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
