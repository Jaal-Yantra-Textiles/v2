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
import { websiteQueryKeys } from "./websites";

export type BlockType = "MainContent" | "Gallery" | "Section" | "Custom";

export type BlockContent = {
  text?: string;
  images?: string[];
  layout?: "full" | "split" | "grid";
  columns?: number;
  authors?: string[];
  image?: {
    type: "image";
    content: string;
  };
  type?: "blog";
};

export type BlockSettings = {
  backgroundColor?: string;
  textColor?: string;
  padding?: string;
  alignment?: "left" | "center" | "right";
};

export type Block = {
  name: string;
  type: BlockType;
  content?: BlockContent;
  settings?: BlockSettings;
  order: number;
};

export type AdminPage = {
  id: string;
  website_id?: string;
  title: string;
  slug: string;
  content: string;
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
  public_metadata?: Record<string, unknown>;
};

export type CreateAdminPagePayload = {
  title: string;
  slug: string;
  content?: string;
  page_type: AdminPage["page_type"];
  status?: AdminPage["status"];
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  published_at?: string;
  metadata?: Record<string, unknown>| null;
  blocks?: Block[];
  public_metadata?: Record<string, unknown>| null;
};

export type CreateAdminPagesPayload = {
  pages: CreateAdminPagePayload[];
};

export type CreatePagesPayload = CreateAdminPagePayload | CreateAdminPagesPayload;

export type UpdateAdminPagePayload = Partial<CreateAdminPagePayload>;

export interface AdminPageResponse {
  page: AdminPage;
}

export interface AdminPagesResponse {
  pages: AdminPage[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminPagesQuery {
  q?: string;
  offset?: number;
  limit?: number;
  status?: AdminPage["status"];
  page_type?: string;
}

const PAGE_QUERY_KEY = "pages" as const;
export const pageQueryKeys = queryKeysFactory(PAGE_QUERY_KEY);

export const usePage = (
  websiteId: string,
  pageId: string,
  options?: Omit<
    UseQueryOptions<AdminPageResponse, FetchError, AdminPageResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: pageQueryKeys.detail(pageId),
    queryFn: async () =>
      sdk.client.fetch<AdminPageResponse>(
        `/admin/websites/${websiteId}/pages/${pageId}`,
        {
          method: "GET",
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const usePages = (
  websiteId: string,
  query?: AdminPagesQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminPagesResponse>,
      FetchError,
      PaginatedResponse<AdminPagesResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: pageQueryKeys.list({ websiteId, ...query }),
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminPagesResponse>>(
        `/admin/websites/${websiteId}/pages`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const useCreatePages = (
  websiteId: string,
  options?: UseMutationOptions<
    AdminPagesResponse,
    FetchError,
    CreatePagesPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePagesPayload) =>
      sdk.client.fetch<AdminPagesResponse>(
        `/admin/websites/${websiteId}/pages`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: () => {
      // Invalidate pages list queries
      queryClient.invalidateQueries({ queryKey: pageQueryKeys.lists() });
      
      // Invalidate both website list and detail queries
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.detail(websiteId) });
    },
    ...options,
  });
};

export const useCreatePagesWithBlocks = (
  websiteId: string,
  options?: UseMutationOptions<
    AdminPagesResponse,
    FetchError,
    CreatePagesPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePagesPayload) => {
      // Handle single page or multiple pages payload
      const singlePage = !('pages' in payload);
      const pagePayload = singlePage ? payload : payload.pages[0];
      
      // Extract blocks if they exist
      const { blocks, ...pageData } = pagePayload;
      
      // Create the page first
      const response = await sdk.client.fetch<AdminPagesResponse>(
        `/admin/websites/${websiteId}/pages`,
        {
          method: "POST",
          body: singlePage ? pageData : { pages: [pageData] },
        }
      );

      // Extract the created page
      const page = ('page' in response ? response.page : response.pages[0]) as AdminPage;
      
      // Create blocks in a separate request if they exist
      if (blocks?.length) {
        // Create blocks for the page
        await sdk.client.fetch(
          `/admin/websites/${websiteId}/pages/${page.id}/blocks`,
          {
            method: "POST",
            body: {
              blocks: blocks.map(block => ({
                name: block.name,
                type: block.type,
                content: block.content || {},
                settings: block.settings || {},
                order: block.order,
                status: "Active"
              }))
            },
          }
        );
      }

      return response;
    },
    onSuccess: () => {
      // Invalidate pages list queries
      queryClient.invalidateQueries({ queryKey: pageQueryKeys.lists() });
      
      // Invalidate both website list and detail queries
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.detail(websiteId) });
    },
    ...options,
  });
};

export const useUpdatePage = (
  websiteId: string,
  pageId: string,
  options?: UseMutationOptions<
    AdminPageResponse,
    FetchError,
    UpdateAdminPagePayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateAdminPagePayload) =>
      sdk.client.fetch<AdminPageResponse>(
        `/admin/websites/${websiteId}/pages/${pageId}`,
        {
          method: "PUT",
          body: payload,
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pageQueryKeys.detail(pageId) });
      queryClient.invalidateQueries({ queryKey: pageQueryKeys.lists() });
    },
    ...options,
  });
};

export const useDeletePage = (
  websiteId: string,
  pageId: string,
  options?: UseMutationOptions<AdminPage, FetchError, void>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminPage>(
        `/admin/websites/${websiteId}/pages/${pageId}`,
        {
          method: "DELETE",
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pageQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.detail(websiteId) });
    },
    ...options,
  });
};
