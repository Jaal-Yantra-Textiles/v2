import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

export type Hashtag = {
  tag: string
  platform: "facebook" | "instagram" | "twitter" | "linkedin" | "all"
  usage_count: number
  last_used_at: string | null
}

export type HashtagsResponse = {
  hashtags: Hashtag[]
}

/**
 * Hook to get hashtag suggestions based on search query
 * Now supports smart caching with platform APIs
 */
export const useHashtagSuggestions = (
  query: string,
  platform?: "facebook" | "instagram" | "twitter" | "linkedin" | "all",
  platformId?: string,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["hashtags", "suggestions", query, platform, platformId],
    queryFn: async () => {
      const params: Record<string, string> = {
        q: query,
        type: "suggestions",
      }
      if (platform) {
        params.platform = platform
      }
      if (platformId) {
        params.platform_id = platformId
      }
      
      return sdk.client.fetch<HashtagsResponse>(`/admin/socials/hashtags`, {
        method: "GET",
        query: params,
      })
    },
    enabled: enabled && query.length > 0,
  })
}

/**
 * Hook to get popular hashtags
 */
export const usePopularHashtags = (
  platform?: "facebook" | "instagram" | "twitter" | "linkedin" | "all",
  limit: number = 20
) => {
  return useQuery({
    queryKey: ["hashtags", "popular", platform, limit],
    queryFn: async () => {
      const params: Record<string, string> = {
        type: "popular",
        limit: limit.toString(),
      }
      if (platform) {
        params.platform = platform
      }
      
      return sdk.client.fetch<HashtagsResponse>(`/admin/socials/hashtags`, {
        method: "GET",
        query: params,
      })
    },
  })
}

/**
 * Hook to get recently used hashtags
 */
export const useRecentHashtags = (
  platform?: "facebook" | "instagram" | "twitter" | "all",
  limit: number = 20
) => {
  return useQuery({
    queryKey: ["hashtags", "recent", platform, limit],
    queryFn: async () => {
      const params: Record<string, string> = {
        type: "recent",
        limit: limit.toString(),
      }
      if (platform) {
        params.platform = platform
      }
      
      return sdk.client.fetch<HashtagsResponse>(`/admin/socials/hashtags`, {
        method: "GET",
        query: params,
      })
    },
  })
}

/**
 * Hook to sync hashtags and mentions from platform
 */
export const useSyncPlatformData = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (platform_id: string) => {
      return sdk.client.fetch(`/admin/socials/sync-platform-data`, {
        method: "POST",
        body: { platform_id },
      })
    },
    onSuccess: () => {
      // Invalidate all hashtag and mention queries to refetch
      queryClient.invalidateQueries({ queryKey: ["hashtags"] })
      queryClient.invalidateQueries({ queryKey: ["mentions"] })
    },
  })
}
