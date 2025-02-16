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
import { sdk } from "../../lib/sdk";
import { queryKeysFactory } from "../../lib/query-key-factory";
import { pageQueryKeys } from "./pages";

const UNIQUE_BLOCKS = [
  "Hero",
  "Header",
  "Footer",
  "MainContent",
  "ContactForm",
] as const;

const REPEATABLE_BLOCKS = [
  "Feature",
  "Gallery",
  "Testimonial",
  "Product",
  "Section",
  "Custom",
] as const;

export type BlockType = typeof UNIQUE_BLOCKS[number] | typeof REPEATABLE_BLOCKS[number];

export type BlockContent = {
  text?: string;
  images?: string[];
  layout?: "full" | "split" | "grid";
  columns?: number;
  [key: string]: unknown;
};

export type BlockSettings = {
  backgroundColor?: string;
  textColor?: string;
  padding?: string;
  alignment?: "left" | "center" | "right";
  [key: string]: unknown;
};

export type AdminBlock = {
  id: string;
  name: string;
  type: BlockType;
  content?: BlockContent;
  settings?: BlockSettings;
  order: number;
  status: "Active" | "Inactive" | "Draft";
  page_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CreateAdminBlockPayload = {
  name: string;
  type: BlockType;
  content?: BlockContent;
  settings?: BlockSettings;
  order?: number;
  status?: AdminBlock["status"];
  metadata?: Record<string, unknown>;
};

export type CreateAdminBlocksPayload = {
  blocks: CreateAdminBlockPayload[];
};

export type UpdateAdminBlockPayload = Partial<CreateAdminBlockPayload>;

export type AdminBlockResponse = {
  block: AdminBlock;
};

export type AdminBlocksCreateResponse = {
  blocks: AdminBlock[];
};

export type AdminBlocksResponse = {
  blocks: AdminBlock[];
  count: number;
  offset: number;
  limit: number;
};

export type AdminBlocksQuery = {
  q?: string;
  offset?: number;
  limit?: number;
  status?: AdminBlock["status"];
  type?: BlockType;
};

const BLOCK_QUERY_KEY = "blocks" as const;
export const blockQueryKeys = queryKeysFactory(BLOCK_QUERY_KEY);

/**
 * Get a single block
 */
export const useBlock = (
  websiteId: string,
  pageId: string,
  blockId: string,
  options?: Omit<
    UseQueryOptions<AdminBlockResponse, FetchError, AdminBlockResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: blockQueryKeys.detail(blockId),
    queryFn: async () =>
      sdk.client.fetch<AdminBlockResponse>(
        `/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`,
        {
          method: "GET",
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};

/**
 * Get a list of blocks for a page
 */
export const useBlocks = (
  websiteId: string,
  pageId: string,
  query?: AdminBlocksQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminBlocksResponse>,
      FetchError,
      PaginatedResponse<AdminBlocksResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: blockQueryKeys.list({ websiteId, pageId, ...query }),
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminBlocksResponse>>(
        `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};

/**
 * Create one or more blocks
 */
export const useCreateBlock = (
  websiteId: string,
  pageId: string,
  options?: UseMutationOptions<
    AdminBlocksCreateResponse,
    FetchError,
    CreateAdminBlockPayload | CreateAdminBlocksPayload
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateAdminBlockPayload | CreateAdminBlocksPayload) =>
      sdk.client.fetch<AdminBlocksCreateResponse>(
        `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: blockQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: pageQueryKeys.detail(pageId) });
    },
    ...options,
  });
};

/**
 * Update an existing block
 */
export const useUpdateBlock = (
  websiteId: string,
  pageId: string,
  blockId: string,
  options?: UseMutationOptions<
    AdminBlockResponse,
    FetchError,
    UpdateAdminBlockPayload
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateAdminBlockPayload) =>
      sdk.client.fetch<AdminBlockResponse>(
        `/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`,
        {
          method: "PUT",
          body: payload,
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: blockQueryKeys.detail(blockId) });
      queryClient.invalidateQueries({ queryKey: blockQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: pageQueryKeys.detail(pageId) });
    },
    ...options,
  });
};

/**
 * Delete a block
 */
export const useDeleteBlock = (
  websiteId: string,
  pageId: string,
  blockId: string,
  options?: UseMutationOptions<AdminBlock, FetchError, void>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminBlock>(
        `/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`,
        {
          method: "DELETE",
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: blockQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: pageQueryKeys.detail(pageId) });
    },
    ...options,
  });
};
