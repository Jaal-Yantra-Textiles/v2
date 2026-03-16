import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseQueryOptions,
  UseMutationOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

// -- Types --

export type ContentBlock = {
  id: string
  name: string
  type: string
  content?: Record<string, unknown>
  settings?: Record<string, unknown>
  order: number
  status: "Active" | "Inactive" | "Draft"
  page_id: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ContentPage = {
  id: string
  website_id?: string
  title: string
  slug: string
  content: string
  page_type: string
  status: "Draft" | "Published" | "Archived"
  meta_title?: string
  meta_description?: string
  meta_keywords?: string
  published_at?: string
  metadata?: Record<string, unknown>
  blocks?: ContentBlock[]
  created_at: string
  updated_at: string
}

export type ContentWebsite = {
  id: string
  domain: string
  name: string
  status: string
  pages?: ContentPage[]
}

// -- Query Keys --

const CONTENT_QUERY_KEY = "partner_content" as const
export const contentQueryKeys = queryKeysFactory(CONTENT_QUERY_KEY)

// -- Website --

export const usePartnerWebsite = (
  options?: Omit<
    UseQueryOptions<
      { website: ContentWebsite | null; message?: string },
      FetchError,
      { website: ContentWebsite | null; message?: string },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ website: ContentWebsite | null; message?: string }>(
        "/partners/storefront/website",
        { method: "GET" }
      ),
    queryKey: contentQueryKeys.detail("website"),
    ...options,
  })
  return { website: data?.website || null, message: data?.message, ...rest }
}

export const useCreatePartnerWebsite = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ website: ContentWebsite; seeded_pages: any[] }>(
        "/partners/storefront/website",
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentQueryKeys.all })
    },
  })
}

// -- Pages --

export const useContentPages = (
  query?: { limit?: number; offset?: number; status?: string },
  options?: Omit<
    UseQueryOptions<any, FetchError, any, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{
        pages: ContentPage[]
        count: number
        offset: number
        limit: number
      }>("/partners/storefront/pages", {
        method: "GET",
        query,
      }),
    queryKey: contentQueryKeys.list({ type: "pages", ...query }),
    ...options,
  })
  return {
    pages: data?.pages || [],
    count: data?.count || 0,
    ...rest,
  }
}

export const useContentPage = (
  pageId: string,
  options?: Omit<
    UseQueryOptions<{ page: ContentPage }, FetchError, { page: ContentPage }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ page: ContentPage }>(
        `/partners/storefront/pages/${pageId}`,
        { method: "GET" }
      ),
    queryKey: contentQueryKeys.detail(pageId),
    enabled: !!pageId,
    ...options,
  })
  return { page: data?.page || null, ...rest }
}

export const useCreateContentPage = () => {
  return useMutation({
    mutationFn: (payload: {
      title: string
      slug: string
      content: string
      page_type?: string
      status?: string
    }) =>
      sdk.client.fetch<{ page: ContentPage }>("/partners/storefront/pages", {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentQueryKeys.lists(),
      })
    },
  })
}

export const useUpdateContentPage = (pageId: string) => {
  return useMutation({
    mutationFn: (payload: Partial<ContentPage>) =>
      sdk.client.fetch<{ page: ContentPage }>(
        `/partners/storefront/pages/${pageId}`,
        { method: "PUT", body: payload }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentQueryKeys.detail(pageId),
      })
      queryClient.invalidateQueries({
        queryKey: contentQueryKeys.lists(),
      })
    },
  })
}

export const useDeleteContentPage = (pageId: string) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/storefront/pages/${pageId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentQueryKeys.lists(),
      })
    },
  })
}

// -- Blocks --

export const useContentBlocks = (
  pageId: string,
  options?: Omit<
    UseQueryOptions<any, FetchError, any, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ blocks: ContentBlock[]; count: number }>(
        `/partners/storefront/pages/${pageId}/blocks`,
        { method: "GET" }
      ),
    queryKey: contentQueryKeys.list({ type: "blocks", pageId }),
    enabled: !!pageId,
    ...options,
  })
  return { blocks: data?.blocks || [], count: data?.count || 0, ...rest }
}

// -- Seed --

export const useSeedContentPages = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ pages: any[]; skipped: string[] }>(
        "/partners/storefront/seed-pages",
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentQueryKeys.all })
    },
  })
}
