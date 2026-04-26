import { useQuery, UseQueryOptions, QueryKey } from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"
import { sdk } from "../../lib/config"

export type FacebookPage = { id: string; name?: string }
export type FacebookPagesResponse = { pages: FacebookPage[] }

export const facebookPagesQueryKey = (platformId?: string) => [
  "facebook_pages",
  platformId || "none",
] as const

export const useFacebookPages = (
  platformId?: string,
  options?: Omit<UseQueryOptions<FacebookPagesResponse, FetchError, FacebookPagesResponse, QueryKey>, "queryFn" | "queryKey">
) => {
  const enabled = Boolean(platformId)
  const query = useQuery({
    queryKey: facebookPagesQueryKey(platformId),
    queryFn: async () =>
      sdk.client.fetch<FacebookPagesResponse>("/admin/socials/facebook/pages", {
        method: "GET",
        query: { platform_id: platformId },
      }),
    enabled,
    staleTime: 1000 * 60, // 1 min
    ...options,
  })

  const pages = Array.isArray(query.data?.pages) ? query.data!.pages : []

  return { pages, ...query }
}
