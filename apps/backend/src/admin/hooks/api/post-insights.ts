import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

/**
 * Hook to sync insights for a single post
 */
export const useSyncPostInsights = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (postId: string) => {
      return sdk.client.fetch(`/admin/social-posts/${postId}/sync-insights`, {
        method: "POST",
      })
    },
    onSuccess: (_, postId) => {
      // Invalidate post queries to refetch with new insights
      queryClient.invalidateQueries({ queryKey: ["social-posts"] })
      queryClient.invalidateQueries({ queryKey: ["social-post", postId] })
    },
  })
}

/**
 * Hook to bulk sync insights for all posts
 */
export const useSyncAllPostInsights = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (params?: { platform_id?: string; limit?: number }) => {
      const query: Record<string, string> = {}
      
      if (params?.platform_id) {
        query.platform_id = params.platform_id
      }
      if (params?.limit) {
        query.limit = params.limit.toString()
      }
      
      return sdk.client.fetch(`/admin/social-posts/sync-all-insights`, {
        method: "POST",
        query,
      })
    },
    onSuccess: () => {
      // Invalidate all post queries
      queryClient.invalidateQueries({ queryKey: ["social-posts"] })
    },
  })
}
