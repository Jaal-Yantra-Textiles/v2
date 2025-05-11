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

export type SendBlogToSubscribersPayload = {
  subject?: string;
  customMessage?: string;
};

export interface SendBlogToSubscribersResponse {
  workflow_id: string;
  requires_confirmation: boolean;
  confirmation_url: string;
  subscribers: number;
}

export interface ConfirmBlogSubscriptionResponse {
  success: boolean;
}

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
    mutationFn: async () => {
      const response = await fetch(`/admin/websites/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete website');
      }
      
      const { website } = await response.json();
      return website;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: websiteQueryKeys.lists(),
      });
    },
    ...options,
  });
};

/**
 * Hook for sending a blog post to subscribers
 */
export const useSendBlogToSubscribers = (
  websiteId: string,
  pageId: string,
  options?: UseMutationOptions<
    SendBlogToSubscribersResponse,
    FetchError,
    SendBlogToSubscribersPayload
  >
) => {
  return useMutation({
    mutationFn: async (data: SendBlogToSubscribersPayload) => {
      const response = await fetch(
        `/admin/websites/${websiteId}/pages/${pageId}/subs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        }
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to send blog to subscribers');
      }
      
      return await response.json();
    },
    ...options,
  });
};

/**
 * Hook for confirming a blog subscription workflow
 */
export const useConfirmBlogSubscription = (
  websiteId: string,
  pageId: string,
  transactionId: string,
  options?: UseMutationOptions<
    ConfirmBlogSubscriptionResponse,
    FetchError,
    void
  >
) => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/admin/websites/${websiteId}/pages/${pageId}/subs/${transactionId}/confirm`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to confirm blog subscription');
      }
      
      return await response.json();
    },
    onSuccess: () => {
      // Invalidate the page query to refresh the subscription status
      queryClient.invalidateQueries({
        queryKey: ['website', websiteId, 'page', pageId],
      });
    },
    ...options,
  });
};
