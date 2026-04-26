import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

export type Mention = {
  username: string
  display_name: string | null
  platform: "facebook" | "instagram" | "twitter"
  usage_count: number
  last_used_at: string | null
}

export type MentionsResponse = {
  mentions: Mention[]
}

/**
 * Hook to get mention suggestions
 */
export const useMentionSuggestions = (
  query: string,
  platform?: "facebook" | "instagram" | "twitter" | "linkedin",
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["mentions", "suggestions", query, platform],
    queryFn: async () => {
      const params: Record<string, string> = {
        q: query,
      }
      if (platform) {
        params.platform = platform
      }
      
      return sdk.client.fetch<MentionsResponse>(`/admin/socials/mentions`, {
        method: "GET",
        query: params,
      })
    },
    enabled: enabled && query.length > 0,
  })
}

/**
 * Hook to get popular mentions
 */
export const usePopularMentions = (
  platform?: "facebook" | "instagram" | "twitter",
  limit: number = 20
) => {
  return useQuery({
    queryKey: ["mentions", "popular", platform, limit],
    queryFn: async () => {
      const params: Record<string, string> = {
        limit: limit.toString(),
      }
      if (platform) {
        params.platform = platform
      }
      
      return sdk.client.fetch<MentionsResponse>(`/admin/socials/mentions`, {
        method: "GET",
        query: params,
      })
    },
  })
}
