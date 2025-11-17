import SocialPost from "./models/SocialPost";
import SocialPlatform from "./models/SocialPlatform";
import Sma from "./models/sma";
import Hashtag from "./models/hashtag";
import Mention from "./models/mention";
import { MedusaService } from "@medusajs/framework/utils";
import { extractHashtags, extractMentions } from "./utils/text-extraction";


class SocialsService extends MedusaService({
  SocialPost,
  SocialPlatform,
  Sma,
  Hashtag,
  Mention,
}) {
  constructor() {
    super(...arguments)
  }

  /**
   * Extract and store hashtags from text
   */
  async extractAndStoreHashtags(
    text: string,
    platform: "facebook" | "instagram" | "twitter" | "all" = "all"
  ): Promise<string[]> {
    const hashtags = extractHashtags(text)
    
    if (hashtags.length === 0) return []

    const now = new Date()

    // Upsert hashtags (create if not exists, update usage if exists)
    for (const tag of hashtags) {
      const [existing] = await this.listHashtags({
        tag,
        platform,
      })

      if (existing) {
        // Update usage count and last used date
        await this.updateHashtags([{
          selector: { id: existing.id },
          data: {
            usage_count: existing.usage_count + 1,
            last_used_at: now,
          },
        }])
      } else {
        // Create new hashtag
        await this.createHashtags([{
          tag,
          platform,
          usage_count: 1,
          last_used_at: now,
        }])
      }
    }

    return hashtags
  }

  /**
   * Extract and store mentions from text
   */
  async extractAndStoreMentions(
    text: string,
    platform: "facebook" | "instagram" | "twitter"
  ): Promise<string[]> {
    const mentions = extractMentions(text)
    
    if (mentions.length === 0) return []

    const now = new Date()

    // Upsert mentions (create if not exists, update usage if exists)
    for (const username of mentions) {
      const [existing] = await this.listMentions({
        username,
        platform,
      })

      if (existing) {
        // Update usage count and last used date
        await this.updateMentions([{
          selector: { id: existing.id },
          data: {
            usage_count: existing.usage_count + 1,
            last_used_at: now,
          },
        }])
      } else {
        // Create new mention
        await this.createMentions([{
          username,
          platform,
          usage_count: 1,
          last_used_at: now,
        }])
      }
    }

    return mentions
  }

  /**
   * Get hashtag suggestions based on partial input
   */
  async getHashtagSuggestions(
    query: string,
    platform?: "facebook" | "instagram" | "twitter" | "all",
    limit: number = 10
  ) {
    const cleanQuery = query.startsWith('#') ? query.slice(1) : query

    const filters: any = {}
    if (platform) {
      filters.platform = platform
    }

    // Search for hashtags that start with the query
    const hashtags = await this.listHashtags(filters, {
      take: limit,
      order: { usage_count: "DESC" },
    })

    // Filter by query and return
    return hashtags.filter(h => 
      h.tag.toLowerCase().startsWith(cleanQuery.toLowerCase())
    )
  }

  /**
   * Get mention suggestions based on partial input
   */
  async getMentionSuggestions(
    query: string,
    platform?: "facebook" | "instagram" | "twitter",
    limit: number = 10
  ) {
    const cleanQuery = query.startsWith('@') ? query.slice(1) : query

    const filters: any = {}
    if (platform) {
      filters.platform = platform
    }

    // Search for mentions that start with the query
    const mentions = await this.listMentions(filters, {
      take: limit,
      order: { usage_count: "DESC" },
    })

    // Filter by query and return
    return mentions.filter(m => 
      m.username.toLowerCase().startsWith(cleanQuery.toLowerCase()) ||
      m.display_name?.toLowerCase().includes(cleanQuery.toLowerCase())
    )
  }

  /**
   * Get popular hashtags
   */
  async getPopularHashtags(
    platform?: "facebook" | "instagram" | "twitter" | "all",
    limit: number = 20
  ) {
    const filters: any = {}
    if (platform) {
      filters.platform = platform
    }

    return this.listHashtags(filters, {
      take: limit,
      order: { usage_count: "DESC" },
    })
  }

  /**
   * Get recently used hashtags
   */
  async getRecentHashtags(
    platform?: "facebook" | "instagram" | "twitter" | "all",
    limit: number = 20
  ) {
    const filters: any = {}
    if (platform) {
      filters.platform = platform
    }

    return this.listHashtags(filters, {
      take: limit,
      order: { last_used_at: "DESC" },
    })
  }
}

export default SocialsService;
