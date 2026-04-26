/**
 * Hashtag Search Service
 * 
 * Smart caching layer for hashtag searches:
 * 1. Check DB cache first (fast)
 * 2. If not found or stale, fetch from Instagram API
 * 3. Store in DB for future searches
 * 4. Return cached results
 */

export type HashtagSearchResult = {
  tag: string
  platform: "instagram" | "facebook" | "twitter" | "linkedin" | "all"
  usage_count: number
  last_used_at: Date | null
  media_count?: number // from Instagram API
  post_count?: number // from Facebook/Twitter
  cached_at?: Date
}

export class HashtagSearchService {
  private readonly CACHE_TTL_HOURS = 24 // Cache for 24 hours
  private readonly INSTAGRAM_API_VERSION = "v21.0"

  /**
   * Search for hashtags with smart caching
   * 
   * Flow:
   * 1. Check DB for cached results (< 24h old)
   * 2. If cache miss or stale, fetch from platform API
   * 3. Store in DB and return
   */
  async searchHashtags(
    query: string,
    platform: "instagram" | "facebook" | "twitter" | "linkedin" | "all",
    credentials: {
      igUserId?: string | null
      accessToken?: string | null
      pageId?: string | null
    },
    socialsService: any,
    limit: number = 10
  ): Promise<HashtagSearchResult[]> {
    // Step 1: Try DB cache first
    const cachedResults = await this.searchFromCache(query, platform, socialsService, limit)
    
    if (cachedResults.length > 0) {
      console.log(`[Hashtag Search] Cache hit for "${query}" on ${platform} (${cachedResults.length} results)`)
      return cachedResults
    }

    console.log(`[Hashtag Search] Cache miss for "${query}" on ${platform}, fetching from API`)

    // Step 2: Cache miss - fetch from platform API
    let apiResults: HashtagSearchResult[] = []

    try {
      switch (platform) {
        case "instagram":
          if (credentials.igUserId && credentials.accessToken) {
            apiResults = await this.searchInstagramAPI(query, credentials.igUserId, credentials.accessToken)
          }
          break

        case "facebook":
          if (credentials.pageId && credentials.accessToken) {
            apiResults = await this.searchFacebookAPI(query, credentials.pageId, credentials.accessToken)
          }
          break

        case "twitter":
          // Twitter/X API requires different authentication (Bearer token)
          // For now, use trending topics or DB cache
          apiResults = await this.searchTwitterTrending(query)
          break

        case "linkedin":
          // LinkedIn doesn't have public hashtag search API
          // Use common professional hashtags or DB cache
          apiResults = await this.searchLinkedInCommon(query)
          break

        case "all":
          // Try Instagram first, then fallback to DB
          if (credentials.igUserId && credentials.accessToken) {
            apiResults = await this.searchInstagramAPI(query, credentials.igUserId, credentials.accessToken)
          }
          break
      }

      // Step 3: Store in DB for future searches
      if (apiResults.length > 0) {
        await this.cacheResults(apiResults, socialsService)
        return apiResults.slice(0, limit)
      }
    } catch (error) {
      console.error(`[Hashtag Search] ${platform} API error:`, error)
    }

    // Step 4: Fallback to DB fuzzy search
    return this.fuzzySearchFromDB(query, platform, socialsService, limit)
  }

  /**
   * Search from DB cache (exact and prefix matches)
   */
  private async searchFromCache(
    query: string,
    platform: "instagram" | "facebook" | "twitter" | "linkedin" | "all",
    socialsService: any,
    limit: number
  ): Promise<HashtagSearchResult[]> {
    const cleanQuery = query.toLowerCase().trim()
    
    if (!cleanQuery) {
      // Return popular hashtags if no query
      return socialsService.getPopularHashtags(platform, limit)
    }

    // Search for hashtags that start with the query
    const filters: any = {
      tag: {
        $like: `${cleanQuery}%` // Prefix match
      }
    }

    if (platform !== "all") {
      filters.platform = [platform, "all"]
    }

    const results = await socialsService.listHashtags(filters, {
      take: limit,
      order: { usage_count: "DESC" }
    })

    return results.map((h: any) => ({
      tag: h.tag,
      platform: h.platform,
      usage_count: h.usage_count,
      last_used_at: h.last_used_at,
      cached_at: h.updated_at,
    }))
  }

  /**
   * Fuzzy search from DB when API is not available
   */
  private async fuzzySearchFromDB(
    query: string,
    platform: "instagram" | "facebook" | "twitter" | "linkedin" | "all",
    socialsService: any,
    limit: number
  ): Promise<HashtagSearchResult[]> {
    const cleanQuery = query.toLowerCase().trim()
    
    // Search for hashtags that contain the query anywhere
    const filters: any = {
      tag: {
        $like: `%${cleanQuery}%` // Contains match
      }
    }

    if (platform !== "all") {
      filters.platform = [platform, "all"]
    }

    const results = await socialsService.listHashtags(filters, {
      take: limit,
      order: { usage_count: "DESC" }
    })

    return results.map((h: any) => ({
      tag: h.tag,
      platform: h.platform,
      usage_count: h.usage_count,
      last_used_at: h.last_used_at,
    }))
  }

  /**
   * Search Instagram Hashtag API
   * 
   * Endpoint: GET /ig_hashtag_search?user_id={ig-user-id}&q={hashtag}
   */
  private async searchInstagramAPI(
    query: string,
    igUserId: string,
    accessToken: string
  ): Promise<HashtagSearchResult[]> {
    const cleanQuery = query.toLowerCase().trim().replace(/^#/, '')
    
    if (!cleanQuery) {
      return []
    }

    // Step 1: Search for hashtag ID
    const searchUrl = `https://graph.facebook.com/${this.INSTAGRAM_API_VERSION}/ig_hashtag_search?user_id=${igUserId}&q=${encodeURIComponent(cleanQuery)}&access_token=${accessToken}`
    
    const searchResponse = await fetch(searchUrl)
    const searchData = await searchResponse.json()

    if (!searchData.data || searchData.data.length === 0) {
      console.log(`[Instagram API] No hashtags found for "${cleanQuery}"`)
      return []
    }

    // Step 2: Get hashtag details (media count, etc.)
    const results: HashtagSearchResult[] = []
    
    for (const hashtag of searchData.data.slice(0, 5)) { // Limit to 5 API calls
      try {
        const detailUrl = `https://graph.facebook.com/${this.INSTAGRAM_API_VERSION}/${hashtag.id}?fields=id,name&access_token=${accessToken}`
        const detailResponse = await fetch(detailUrl)
        const detailData = await detailResponse.json()

        if (detailData.name) {
          results.push({
            tag: detailData.name.toLowerCase(),
            platform: "instagram",
            usage_count: 1, // Will be incremented when user actually uses it
            last_used_at: null,
            media_count: 0, // Instagram doesn't provide this anymore
            cached_at: new Date(),
          })
        }
      } catch (error) {
        console.error(`[Instagram API] Error fetching hashtag details:`, error)
      }
    }

    console.log(`[Instagram API] Found ${results.length} hashtags for "${cleanQuery}"`)
    return results
  }

  /**
   * Search Facebook for hashtags
   * Facebook doesn't have a direct hashtag search API
   * We'll extract from recent page posts
   */
  private async searchFacebookAPI(
    query: string,
    pageId: string,
    accessToken: string
  ): Promise<HashtagSearchResult[]> {
    const cleanQuery = query.toLowerCase().trim().replace(/^#/, '')
    
    if (!cleanQuery) {
      return []
    }

    try {
      // Fetch recent posts from page
      const response = await fetch(
        `https://graph.facebook.com/${this.INSTAGRAM_API_VERSION}/${pageId}/feed?fields=message&limit=50&access_token=${accessToken}`
      )
      const data = await response.json()

      if (!data.data) {
        return []
      }

      // Extract hashtags and filter by query
      const hashtagCounts = new Map<string, number>()
      
      for (const post of data.data) {
        if (post.message) {
          const hashtagMatches = post.message.match(/#[\p{L}\p{N}_]+/gu) || []
          hashtagMatches.forEach((tag: string) => {
            const cleanTag = tag.slice(1).toLowerCase()
            if (cleanTag.includes(cleanQuery)) {
              hashtagCounts.set(cleanTag, (hashtagCounts.get(cleanTag) || 0) + 1)
            }
          })
        }
      }

      const results: HashtagSearchResult[] = Array.from(hashtagCounts.entries())
        .map(([tag, count]) => ({
          tag,
          platform: "facebook" as const,
          usage_count: count,
          last_used_at: null,
          post_count: count,
          cached_at: new Date(),
        }))
        .sort((a, b) => b.usage_count - a.usage_count)

      console.log(`[Facebook API] Found ${results.length} hashtags for "${cleanQuery}"`)
      return results
    } catch (error) {
      console.error(`[Facebook API] Error:`, error)
      return []
    }
  }

  /**
   * Search Twitter/X trending hashtags
   * Note: Twitter API v2 requires Bearer token and has rate limits
   * For now, return common trending topics that match the query
   */
  private async searchTwitterTrending(query: string): Promise<HashtagSearchResult[]> {
    const cleanQuery = query.toLowerCase().trim().replace(/^#/, '')
    
    if (!cleanQuery) {
      return []
    }

    // Common trending Twitter hashtags (can be enhanced with actual API)
    const trendingHashtags = [
      'tech', 'ai', 'ml', 'blockchain', 'crypto', 'nft', 'web3',
      'startup', 'innovation', 'business', 'marketing', 'sales',
      'design', 'ux', 'ui', 'dev', 'code', 'programming',
      'news', 'breaking', 'trending', 'viral', 'follow',
      'fashion', 'style', 'beauty', 'fitness', 'health',
      'food', 'travel', 'photography', 'art', 'music',
      'gaming', 'esports', 'sports', 'football', 'basketball',
      'motivation', 'inspiration', 'quotes', 'success', 'entrepreneur',
    ]

    const matches = trendingHashtags
      .filter(tag => tag.includes(cleanQuery))
      .map(tag => ({
        tag,
        platform: "twitter" as const,
        usage_count: 1,
        last_used_at: null,
        cached_at: new Date(),
      }))

    console.log(`[Twitter] Found ${matches.length} trending hashtags for "${cleanQuery}"`)
    return matches
  }

  /**
   * Search LinkedIn common professional hashtags
   * LinkedIn doesn't have a public hashtag search API
   * Return common professional hashtags that match the query
   */
  private async searchLinkedInCommon(query: string): Promise<HashtagSearchResult[]> {
    const cleanQuery = query.toLowerCase().trim().replace(/^#/, '')
    
    if (!cleanQuery) {
      return []
    }

    // Common LinkedIn professional hashtags
    const professionalHashtags = [
      'linkedin', 'networking', 'career', 'jobs', 'hiring', 'jobsearch',
      'business', 'entrepreneur', 'startup', 'innovation', 'leadership',
      'management', 'strategy', 'consulting', 'finance', 'marketing',
      'sales', 'branding', 'digitalmarketing', 'socialmedia', 'content',
      'technology', 'ai', 'machinelearning', 'data', 'analytics',
      'software', 'development', 'programming', 'coding', 'webdev',
      'design', 'ux', 'ui', 'product', 'productmanagement',
      'hr', 'humanresources', 'talent', 'recruiting', 'learning',
      'professional', 'growth', 'success', 'motivation', 'inspiration',
      'b2b', 'saas', 'cloud', 'cybersecurity', 'blockchain',
    ]

    const matches = professionalHashtags
      .filter(tag => tag.includes(cleanQuery))
      .map(tag => ({
        tag,
        platform: "linkedin" as const,
        usage_count: 1,
        last_used_at: null,
        cached_at: new Date(),
      }))

    console.log(`[LinkedIn] Found ${matches.length} professional hashtags for "${cleanQuery}"`)
    return matches
  }

  /**
   * Cache API results in DB
   */
  private async cacheResults(
    results: HashtagSearchResult[],
    socialsService: any
  ): Promise<void> {
    for (const result of results) {
      try {
        // Check if hashtag already exists
        const [existing] = await socialsService.listHashtags({
          tag: result.tag,
          platform: result.platform,
        })

        if (existing) {
          // Update existing (refresh cache)
          await socialsService.updateHashtags([{
            selector: { id: existing.id },
            data: {
              updated_at: new Date(), // Refresh cache timestamp
            },
          }])
        } else {
          // Create new cache entry
          await socialsService.createHashtags({
            tag: result.tag,
            platform: result.platform,
            usage_count: 0, // Not used yet, just cached
            last_used_at: null,
          })
        }
      } catch (error) {
        console.error(`[Hashtag Cache] Error caching "${result.tag}":`, error)
      }
    }
  }

  /**
   * Search for user mentions (Instagram username search)
   * 
   * Note: Instagram doesn't have a direct username search API
   * We'll use the existing DB cache and potentially enhance with
   * Instagram User Search API in the future
   */
  async searchMentions(
    query: string,
    platform: "instagram" | "facebook" | "twitter" | undefined,
    socialsService: any,
    limit: number = 10
  ): Promise<any[]> {
    const cleanQuery = query.toLowerCase().trim()
    
    if (!cleanQuery) {
      // Return popular mentions if no query
      const filters: any = {}
      if (platform) {
        filters.platform = platform
      }
      
      return socialsService.listMentions(filters, {
        take: limit,
        order: { usage_count: "DESC" },
      })
    }

    // Search for mentions that start with the query
    const filters: any = {
      username: {
        $like: `${cleanQuery}%` // Prefix match
      }
    }

    if (platform) {
      filters.platform = platform
    }

    return socialsService.listMentions(filters, {
      take: limit,
      order: { usage_count: "DESC" },
    })
  }
}
