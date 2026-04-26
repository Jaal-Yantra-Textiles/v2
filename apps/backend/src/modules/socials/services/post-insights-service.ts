/**
 * Post Insights Service
 * 
 * Fetches comprehensive post data from social platforms:
 * - Post details (status, type, permalink)
 * - Engagement metrics (likes, comments, shares, saves)
 * - Reach & impressions
 * - Audience insights
 * - Media performance
 * 
 * All data is stored in the `insights` JSON field
 */

export type PostInsights = {
  // Platform identifiers
  platform: "facebook" | "instagram" | "twitter" | "linkedin"
  platform_post_id: string
  permalink?: string
  
  // Post details
  post_type?: string
  media_type?: string
  caption?: string
  created_time?: string
  
  // Engagement metrics
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  reactions?: {
    like?: number
    love?: number
    wow?: number
    haha?: number
    sad?: number
    angry?: number
    total?: number
  }
  
  // Reach & impressions
  impressions?: number
  reach?: number
  engagement?: number
  engagement_rate?: number
  engagement_score?: number
  sentiment_score?: number
  clicks?: number
  
  // Video metrics (if applicable)
  video_views?: number
  video_avg_time_watched?: number
  video_complete_views?: number
  
  // Instagram specific
  instagram_insights?: {
    impressions?: number
    reach?: number
    engagement?: number
    saved?: number
    profile_visits?: number
    follows?: number
    shares?: number
  }
  
  // Facebook specific
  facebook_insights?: {
    post_impressions?: number
    post_impressions_unique?: number
    post_impressions_paid?: number
    post_impressions_organic?: number
    post_engaged_users?: number
    post_clicks?: number
    post_reactions_by_type?: Record<string, number>
  }
  
  // Comments data
  comments_data?: Array<{
    id: string
    text: string
    from: {
      id: string
      name: string
    }
    created_time: string
    like_count?: number
  }>
  
  // Metadata
  last_synced_at: string
  sync_status: "success" | "partial" | "failed"
  sync_errors?: string[]
}

export class PostInsightsService {
  private readonly INSTAGRAM_API_VERSION = "v21.0"
  private readonly FACEBOOK_API_VERSION = "v21.0"

  /**
   * Sync insights for a single post
   */
  async syncPostInsights(
    postId: string,
    platformPostId: string,
    platform: "facebook" | "instagram" | "twitter" | "linkedin",
    accessToken: string,
    socialsService: any
  ): Promise<PostInsights> {
    console.log(`[Insights Sync] Starting sync for ${platform} post ${platformPostId}`)

    let insights: PostInsights = {
      platform,
      platform_post_id: platformPostId,
      last_synced_at: new Date().toISOString(),
      sync_status: "success",
      sync_errors: [],
    }

    try {
      switch (platform) {
        case "instagram":
          insights = await this.syncInstagramInsights(platformPostId, accessToken, insights)
          break
        case "facebook":
          insights = await this.syncFacebookInsights(platformPostId, accessToken, insights)
          break
        case "twitter":
          insights = await this.syncTwitterInsights(platformPostId, accessToken, insights)
          break
        case "linkedin":
          insights = await this.syncLinkedInInsights(platformPostId, accessToken, insights)
          break
      }

      // Store insights in database
      await this.storeInsights(postId, insights, socialsService)

      // Check if we have any sync errors but still got some data
      if (insights.sync_errors && insights.sync_errors.length > 0) {
        insights.sync_status = "partial"
        console.log(`[Insights Sync] ⚠ Partially synced ${platform} post ${platformPostId} (${insights.sync_errors.length} errors)`)
      } else {
        console.log(`[Insights Sync] ✓ Successfully synced ${platform} post ${platformPostId}`)
      }
      
      return insights
    } catch (error) {
      console.error(`[Insights Sync] ✗ Error syncing ${platform} post:`, error)
      insights.sync_status = "failed"
      insights.sync_errors = insights.sync_errors || []
      insights.sync_errors.push(error.message)
      
      // Store partial insights even on error
      await this.storeInsights(postId, insights, socialsService)
      
      throw error
    }
  }

  /**
   * Sync Instagram post insights
   */
  private async syncInstagramInsights(
    mediaId: string,
    accessToken: string,
    baseInsights: PostInsights
  ): Promise<PostInsights> {
    const insights = { ...baseInsights }

    try {
      // Fetch media details
      const mediaFields = [
        "id",
        "media_type",
        "media_url",
        "permalink",
        "caption",
        "timestamp",
        "like_count",
        "comments_count",
      ].join(",")

      const mediaResponse = await fetch(
        `https://graph.facebook.com/${this.INSTAGRAM_API_VERSION}/${mediaId}?fields=${mediaFields}&access_token=${accessToken}`
      )
      const mediaData = await mediaResponse.json()

      if (mediaData.error) {
        throw new Error(mediaData.error.message)
      }

      // Basic metrics
      insights.media_type = mediaData.media_type
      insights.permalink = mediaData.permalink
      insights.caption = mediaData.caption
      insights.created_time = mediaData.timestamp
      insights.likes = mediaData.like_count
      insights.comments = mediaData.comments_count

      // Fetch insights (impressions, reach, engagement, saves)
      const insightMetrics = [
        "impressions",
        "reach",
        "engagement",
        "saved",
        "profile_visits",
        "follows",
        "shares",
      ].join(",")

      try {
        const insightsResponse = await fetch(
          `https://graph.facebook.com/${this.INSTAGRAM_API_VERSION}/${mediaId}/insights?metric=${insightMetrics}&access_token=${accessToken}`
        )
        const insightsData = await insightsResponse.json()

        if (insightsData.data) {
          insights.instagram_insights = {}
          
          insightsData.data.forEach((metric: any) => {
            const value = metric.values?.[0]?.value || 0
            insights.instagram_insights![metric.name] = value
            
            // Also set top-level fields
            if (metric.name === "impressions") insights.impressions = value
            if (metric.name === "reach") insights.reach = value
            if (metric.name === "engagement") insights.engagement = value
            if (metric.name === "saved") insights.saves = value
          })

          // Calculate engagement rate
          if (insights.reach && insights.engagement) {
            insights.engagement_rate = (insights.engagement / insights.reach) * 100
          }
        }
      } catch (error) {
        console.warn("[Instagram Insights] Could not fetch insights metrics:", error.message)
        insights.sync_errors?.push(`Insights metrics: ${error.message}`)
      }

      // Fetch comments
      try {
        const commentsResponse = await fetch(
          `https://graph.facebook.com/${this.INSTAGRAM_API_VERSION}/${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=100&access_token=${accessToken}`
        )
        const commentsData = await commentsResponse.json()

        if (commentsData.data) {
          insights.comments_data = commentsData.data.map((comment: any) => ({
            id: comment.id,
            text: comment.text,
            from: {
              id: comment.username,
              name: comment.username,
            },
            created_time: comment.timestamp,
            like_count: comment.like_count || 0,
          }))
        }
      } catch (error) {
        console.warn("[Instagram Insights] Could not fetch comments:", error.message)
        insights.sync_errors?.push(`Comments: ${error.message}`)
      }

      // If video, fetch video insights
      if (mediaData.media_type === "VIDEO" || mediaData.media_type === "REELS") {
        try {
          const videoMetrics = ["video_views", "total_interactions"].join(",")
          const videoInsightsResponse = await fetch(
            `https://graph.facebook.com/${this.INSTAGRAM_API_VERSION}/${mediaId}/insights?metric=${videoMetrics}&access_token=${accessToken}`
          )
          const videoInsightsData = await videoInsightsResponse.json()

          if (videoInsightsData.data) {
            videoInsightsData.data.forEach((metric: any) => {
              const value = metric.values?.[0]?.value || 0
              if (metric.name === "video_views") {
                insights.video_views = value
              }
            })
          }
        } catch (error) {
          console.warn("[Instagram Insights] Could not fetch video metrics:", error.message)
        }
      }

    } catch (error) {
      console.error("[Instagram Insights] Error:", error)
      throw error
    }

    return insights
  }

  /**
   * Sync Facebook post insights
   * Optimized to use only available metrics without pages_read_engagement permission
   */
  private async syncFacebookInsights(
    postId: string,
    accessToken: string,
    baseInsights: PostInsights
  ): Promise<PostInsights> {
    const insights = { ...baseInsights }

    try {
      // PHASE 1: Core metrics - Single optimized API call
      // These fields are always available with pages_manage_posts permission
      const postFields = [
        "id",
        "message",
        "created_time",
        "permalink_url",
        "shares.summary(true)",
        "reactions.summary(true)",
        "comments.summary(true)",
        "attachments", // Media info
      ].join(",")

      const postResponse = await fetch(
        `https://graph.facebook.com/${this.FACEBOOK_API_VERSION}/${postId}?fields=${postFields}&access_token=${accessToken}`
      )
      const postData = await postResponse.json()

      if (postData.error) {
        throw new Error(postData.error.message)
      }

      // Basic metrics (always available)
      insights.permalink = postData.permalink_url
      insights.caption = postData.message
      insights.created_time = postData.created_time
      insights.shares = postData.shares?.count || 0
      insights.comments = postData.comments?.summary?.total_count || 0

      // Reactions (always available)
      if (postData.reactions?.summary) {
        insights.likes = postData.reactions.summary.total_count
        insights.reactions = {
          total: postData.reactions.summary.total_count,
        }
      }

      // Calculate basic engagement
      const totalEngagement = (insights.likes || 0) + (insights.comments || 0) + (insights.shares || 0)
      insights.engagement = totalEngagement

      // PHASE 2: Detailed reactions breakdown using insights API (1 API call!)
      // This uses the /{post-id}/insights endpoint which provides lifetime metrics
      // No special permission required!
      try {
        const reactionMetrics = [
          "post_reactions_like_total",
          "post_reactions_love_total",
          "post_reactions_wow_total",
          "post_reactions_haha_total",
          "post_reactions_sorry_total",
          "post_reactions_anger_total",
        ].join(",")

        const reactionsResponse = await fetch(
          `https://graph.facebook.com/${this.FACEBOOK_API_VERSION}/${postId}/insights?metric=${reactionMetrics}&access_token=${accessToken}`
        )
        const reactionsData = await reactionsResponse.json()

        if (reactionsData.error) {
          console.warn("[Facebook Insights] Could not fetch reaction insights:", reactionsData.error.message)
        } else if (reactionsData.data) {
          const reactionCounts: Record<string, number> = {}
          
          // Parse the insights response
          reactionsData.data.forEach((metric: any) => {
            const value = metric.values?.[0]?.value || 0
            
            if (metric.name === "post_reactions_like_total") reactionCounts.like = value
            if (metric.name === "post_reactions_love_total") reactionCounts.love = value
            if (metric.name === "post_reactions_wow_total") reactionCounts.wow = value
            if (metric.name === "post_reactions_haha_total") reactionCounts.haha = value
            if (metric.name === "post_reactions_sorry_total") reactionCounts.sad = value
            if (metric.name === "post_reactions_anger_total") reactionCounts.angry = value
          })

          // Store detailed reaction breakdown
          insights.reactions = {
            like: reactionCounts.like || 0,
            love: reactionCounts.love || 0,
            wow: reactionCounts.wow || 0,
            haha: reactionCounts.haha || 0,
            sad: reactionCounts.sad || 0,
            angry: reactionCounts.angry || 0,
            total: insights.likes,
          }

          // Calculate sentiment score
          const positive = (reactionCounts.like || 0) + (reactionCounts.love || 0) + (reactionCounts.wow || 0) + (reactionCounts.haha || 0)
          const negative = (reactionCounts.sad || 0) + (reactionCounts.angry || 0)
          if (insights.likes && insights.likes > 0) {
            insights.sentiment_score = ((positive - negative) / insights.likes) * 100
          }
        }
      } catch (error) {
        console.warn("[Facebook Insights] Could not fetch detailed reactions:", error.message)
        insights.sync_errors?.push(`Reaction breakdown: ${error.message}`)
      }

      // PHASE 3: Advanced metrics using insights API
      // Try to fetch impressions, reach, and other metrics
      // Note: These may require pages_read_engagement permission
      try {
        const insightMetrics = [
          "post_impressions",                    // Total impressions (lifetime)
          "post_impressions_unique",             // Reach (unique viewers, lifetime)
          "post_impressions_paid",               // Paid impressions
          "post_impressions_organic",            // Organic impressions
          "post_clicks",                         // Total clicks
          "post_clicks_by_type",                 // Clicks by type
        ].join(",")

        const insightsResponse = await fetch(
          `https://graph.facebook.com/${this.FACEBOOK_API_VERSION}/${postId}/insights?metric=${insightMetrics}&access_token=${accessToken}`
        )
        const insightsData = await insightsResponse.json()

        // Check for permission error
        if (insightsData.error) {
          if (insightsData.error.code === 10 || insightsData.error.message?.includes('pages_read_engagement')) {
            console.log("[Facebook Insights] pages_read_engagement permission not available - using basic metrics only")
            // Not an error - just means we don't have advanced permissions
            // Basic metrics are still valuable
          } else {
            console.warn("[Facebook Insights] Error fetching advanced metrics:", insightsData.error.message)
          }
        } else if (insightsData.data) {
          insights.facebook_insights = {}
          
          insightsData.data.forEach((metric: any) => {
            const value = metric.values?.[0]?.value || 0
            insights.facebook_insights![metric.name] = value
            
            // Set top-level fields
            if (metric.name === "post_impressions") insights.impressions = value
            if (metric.name === "post_impressions_unique") insights.reach = value
            if (metric.name === "post_clicks") insights.clicks = value
          })

          // Calculate engagement rate if we have reach
          if (insights.reach && insights.engagement) {
            insights.engagement_rate = (insights.engagement / insights.reach) * 100
          }
        }
      } catch (error) {
        // Don't log or add to sync_errors - this is expected without permission
      }

      // PHASE 4: Comments with full details (1 API call)
      // Always available and provides valuable engagement data
      try {
        const commentsResponse = await fetch(
          `https://graph.facebook.com/${this.FACEBOOK_API_VERSION}/${postId}/comments?fields=id,message,from,created_time,like_count&limit=100&access_token=${accessToken}`
        )
        const commentsData = await commentsResponse.json()

        if (commentsData.error) {
          throw new Error(commentsData.error.message)
        }

        if (commentsData.data) {
          insights.comments_data = commentsData.data.map((comment: any) => ({
            id: comment.id,
            text: comment.message,
            from: {
              id: comment.from?.id,
              name: comment.from?.name,
            },
            created_time: comment.created_time,
            like_count: comment.like_count || 0,
          }))
        }
      } catch (error) {
        console.warn("[Facebook Insights] Could not fetch comments:", error.message)
        insights.sync_errors?.push(`Comments: ${error.message}`)
      }

      // Calculate engagement score (weighted)
      // Shares are most valuable, then comments, then reactions
      const engagementScore = 
        (insights.shares || 0) * 5 + 
        (insights.comments || 0) * 3 + 
        (insights.likes || 0) * 1
      insights.engagement_score = engagementScore

    } catch (error) {
      console.error("[Facebook Insights] Error:", error)
      throw error
    }

    return insights
  }

  /**
   * Sync Twitter post insights
   * Note: Requires Twitter API v2 with appropriate bearer token
   */
  private async syncTwitterInsights(
    tweetId: string,
    bearerToken: string,
    baseInsights: PostInsights
  ): Promise<PostInsights> {
    const insights = { ...baseInsights }

    try {
      // Twitter API v2 endpoint
      const tweetFields = [
        "created_at",
        "public_metrics",
        "organic_metrics",
        "non_public_metrics",
      ].join(",")

      const response = await fetch(
        `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=${tweetFields}`,
        {
          headers: {
            Authorization: `Bearer ${bearerToken}`,
          },
        }
      )
      const data = await response.json()

      if (data.errors) {
        throw new Error(data.errors[0].message)
      }

      const tweet = data.data

      // Basic metrics
      insights.created_time = tweet.created_at
      insights.likes = tweet.public_metrics?.like_count || 0
      insights.comments = tweet.public_metrics?.reply_count || 0
      insights.shares = tweet.public_metrics?.retweet_count || 0
      insights.impressions = tweet.public_metrics?.impression_count || 0

      // Calculate engagement
      insights.engagement = 
        (insights.likes || 0) + 
        (insights.comments || 0) + 
        (insights.shares || 0)

      if (insights.impressions) {
        insights.engagement_rate = (insights.engagement / insights.impressions) * 100
      }

    } catch (error) {
      console.error("[Twitter Insights] Error:", error)
      insights.sync_errors?.push(`Twitter API: ${error.message}`)
      insights.sync_status = "partial"
    }

    return insights
  }

  /**
   * Sync LinkedIn post insights
   * Note: Requires LinkedIn API access
   */
  private async syncLinkedInInsights(
    postId: string,
    accessToken: string,
    baseInsights: PostInsights
  ): Promise<PostInsights> {
    const insights = { ...baseInsights }

    try {
      // LinkedIn API endpoint for post statistics
      const response = await fetch(
        `https://api.linkedin.com/v2/socialActions/${postId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
      const data = await response.json()

      if (data.status && data.status !== 200) {
        throw new Error(data.message || "LinkedIn API error")
      }

      // LinkedIn metrics
      insights.likes = data.likesSummary?.totalLikes || 0
      insights.comments = data.commentsSummary?.totalComments || 0
      insights.shares = data.sharesSummary?.totalShares || 0

      insights.engagement = 
        (insights.likes || 0) + 
        (insights.comments || 0) + 
        (insights.shares || 0)

    } catch (error) {
      console.error("[LinkedIn Insights] Error:", error)
      insights.sync_errors?.push(`LinkedIn API: ${error.message}`)
      insights.sync_status = "partial"
    }

    return insights
  }

  /**
   * Store insights in database
   */
  private async storeInsights(
    postId: string,
    insights: PostInsights,
    socialsService: any
  ): Promise<void> {
    try {
      // Get existing post
      const [post] = await socialsService.listSocialPosts({ id: postId })
      
      if (!post) {
        throw new Error(`Post ${postId} not found`)
      }

      // Preserve existing insights data
      const currentInsights = ((post as any).insights as Record<string, unknown>) || {}

      // Merge with new insights
      const updatedInsights = {
        ...currentInsights,
        ...insights,
        last_updated: new Date().toISOString(),
      }

      // Update post
      await socialsService.updateSocialPosts([{
        selector: { id: postId },
        data: {
          insights: updatedInsights,
        },
      }])

      console.log(`[Insights Storage] ✓ Stored insights for post ${postId}`)
    } catch (error) {
      console.error(`[Insights Storage] ✗ Error storing insights:`, error)
      throw error
    }
  }

  /**
   * Bulk sync insights for multiple posts
   */
  async bulkSyncInsights(
    posts: Array<{
      id: string
      platform_post_id: string
      platform: "facebook" | "instagram" | "twitter" | "linkedin"
    }>,
    accessToken: string,
    socialsService: any
  ): Promise<{
    success: number
    failed: number
    results: Array<{ postId: string; status: string; error?: string }>
  }> {
    const results: Array<{ postId: string; status: string; error?: string }> = []
    let success = 0
    let failed = 0

    for (const post of posts) {
      try {
        await this.syncPostInsights(
          post.id,
          post.platform_post_id,
          post.platform,
          accessToken,
          socialsService
        )
        results.push({ postId: post.id, status: "success" })
        success++
      } catch (error) {
        results.push({ 
          postId: post.id, 
          status: "failed", 
          error: error.message 
        })
        failed++
      }
    }

    return { success, failed, results }
  }
}
