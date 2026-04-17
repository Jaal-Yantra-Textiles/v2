import SocialPost from "./models/SocialPost";
import SocialPlatform from "./models/SocialPlatform";
import Sma from "./models/sma";
import Hashtag from "./models/hashtag";
import Mention from "./models/mention";
import PublishingCampaign from "./models/PublishingCampaign";
import AdAccount from "./models/AdAccount";
import AdCampaign from "./models/AdCampaign";
import AdSet from "./models/AdSet";
import Ad from "./models/Ad";
import LeadForm from "./models/LeadForm";
import Lead from "./models/Lead";
import AdInsights from "./models/AdInsights";
import { MedusaService } from "@medusajs/framework/utils";
import { extractHashtags, extractMentions } from "./utils/text-extraction";
import type { WhatsAppPlatformApiConfig } from "./types/whatsapp-platform";


class SocialsService extends MedusaService({
  SocialPost,
  SocialPlatform,
  Sma,
  Hashtag,
  Mention,
  PublishingCampaign,
  // Meta Ads models
  AdAccount,
  AdCampaign,
  AdSet,
  Ad,
  LeadForm,
  Lead,
  AdInsights,
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

  // ──────────────────────────────────────────────────────────────────────
  // WhatsApp platform resolvers (multi-number support)
  //
  // A SocialPlatform row with api_config.provider === "whatsapp" represents
  // one WhatsApp Business phone number. Multiple rows coexist.
  // ──────────────────────────────────────────────────────────────────────

  /** All active WhatsApp SocialPlatform rows, newest first. */
  async findWhatsAppPlatforms() {
    const rows = await this.listSocialPlatforms({
      category: "communication",
      status: "active",
    })
    return rows.filter((p: any) => {
      const cfg = p?.api_config as Record<string, any> | null
      return cfg?.provider === "whatsapp" || p?.name === "WhatsApp"
    })
  }

  async findWhatsAppPlatformById(id: string) {
    if (!id) return null
    const rows = await this.listSocialPlatforms({ id })
    const platform = rows?.[0]
    if (!platform) return null
    const cfg = platform.api_config as Record<string, any> | null
    if (cfg?.provider !== "whatsapp" && platform.name !== "WhatsApp") return null
    return platform
  }

  async findWhatsAppPlatformByPhoneNumberId(phoneNumberId: string) {
    if (!phoneNumberId) return null
    const all = await this.findWhatsAppPlatforms()
    return (
      all.find(
        (p: any) => (p.api_config as WhatsAppPlatformApiConfig | null)?.phone_number_id === phoneNumberId
      ) ?? null
    )
  }

  /**
   * Default sender: explicit `is_default: true`, else the first configured
   * WhatsApp platform. Returns null when no WhatsApp platform is configured.
   */
  async getDefaultWhatsAppPlatform() {
    const all = await this.findWhatsAppPlatforms()
    if (all.length === 0) return null
    const explicit = all.find(
      (p: any) => (p.api_config as WhatsAppPlatformApiConfig | null)?.is_default === true
    )
    return explicit ?? all[0]
  }

  /**
   * Pick a sender whose `country_codes` matches the recipient's E.164 prefix.
   * Falls back to the default platform when no match is found.
   *
   * Matching rule: longest country-code prefix wins. So "+91" beats "+9" for
   * an Indian number, and "+61" beats "+6" for an Australian number.
   */
  async findWhatsAppPlatformForRecipient(e164: string) {
    const all = await this.findWhatsAppPlatforms()
    if (all.length === 0) return null

    const normalized = e164.startsWith("+") ? e164 : `+${e164}`

    let best: { platform: any; matchLen: number } | null = null
    for (const p of all) {
      const cfg = p.api_config as WhatsAppPlatformApiConfig | null
      const codes = cfg?.country_codes ?? []
      for (const code of codes) {
        const normCode = code.startsWith("+") ? code : `+${code}`
        if (normalized.startsWith(normCode)) {
          if (!best || normCode.length > best.matchLen) {
            best = { platform: p, matchLen: normCode.length }
          }
        }
      }
    }
    return best?.platform ?? (await this.getDefaultWhatsAppPlatform())
  }
}

export default SocialsService;
