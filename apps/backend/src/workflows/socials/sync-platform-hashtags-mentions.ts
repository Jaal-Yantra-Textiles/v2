import { createStep, StepResponse, createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { SOCIALS_MODULE } from "../../modules/socials"
import SocialsService from "../../modules/socials/service"
import FacebookService from "../../modules/social-provider/facebook-service"

type SyncPlatformDataInput = {
  platform_id: string
  access_token: string
}

/**
 * Step to fetch and sync hashtags from Instagram
 * Extracts hashtags from Instagram Business Account's recent media
 */
export const syncInstagramHashtagsStep = createStep(
  "sync-instagram-hashtags",
  async (input: SyncPlatformDataInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const fb = new FacebookService()

    try {
      // Get Instagram Business Account ID from Facebook Pages
      const pages = await fb.listManagedPages(input.access_token)
      
      if (pages.length === 0) {
        return new StepResponse({ synced: 0, message: "No Facebook pages found" })
      }

      // Get Instagram accounts linked to pages
      let igUserId: string | null = null
      for (const page of pages) {
        try {
          const igResponse = await fetch(
            `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${input.access_token}`
          )
          const igData = await igResponse.json()
          if (igData.instagram_business_account?.id) {
            igUserId = igData.instagram_business_account.id
            break
          }
        } catch (error) {
          console.log(`No Instagram account for page ${page.id}`)
        }
      }
      
      if (!igUserId) {
        return new StepResponse({ synced: 0, message: "No Instagram Business Account found" })
      }

      // Fetch recent media to extract hashtags from captions
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${igUserId}/media?fields=caption&limit=50&access_token=${input.access_token}`
      )
      const data = await response.json()

      if (!data.data || data.data.length === 0) {
        return new StepResponse({ synced: 0, message: "No Instagram media found" })
      }

      // Extract hashtags from all captions
      const allHashtags = new Map<string, number>()
      
      for (const media of data.data) {
        if (media.caption) {
          const hashtagMatches = media.caption.match(/#[\p{L}\p{N}_]+/gu) || []
          hashtagMatches.forEach((tag: string) => {
            const cleanTag = tag.slice(1).toLowerCase()
            allHashtags.set(cleanTag, (allHashtags.get(cleanTag) || 0) + 1)
          })
        }
      }

      // Store hashtags in database
      let syncedCount = 0
      for (const [tag, count] of allHashtags.entries()) {
        try {
          const [existing] = await socials.listHashtags({ tag, platform: "instagram" })
          
          if (existing) {
            await socials.updateHashtags([{
              selector: { id: existing.id },
              data: {
                usage_count: existing.usage_count + count,
                last_used_at: new Date(),
              },
            }])
          } else {
            await socials.createHashtags({
              tag,
              platform: "instagram",
              usage_count: count,
              last_used_at: new Date(),
            })
          }
          syncedCount++
        } catch (error) {
          console.error(`Failed to sync hashtag #${tag}:`, error)
        }
      }

      return new StepResponse({ 
        synced: syncedCount, 
        message: `Synced ${syncedCount} hashtags from Instagram` 
      })
    } catch (error) {
      console.error("Error syncing Instagram hashtags:", error)
      return new StepResponse({ synced: 0, message: `Error: ${(error as Error).message}` })
    }
  }
)

/**
 * Step to fetch and sync mentions from Instagram
 * Extracts mentions from recent media captions
 */
export const syncInstagramMentionsStep = createStep(
  "sync-instagram-mentions",
  async (input: SyncPlatformDataInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const fb = new FacebookService()

    try {
      // Get Instagram Business Account ID from Facebook Pages
      const pages = await fb.listManagedPages(input.access_token)
      
      if (pages.length === 0) {
        return new StepResponse({ synced: 0, message: "No Facebook pages found" })
      }

      // Get Instagram accounts linked to pages
      let igUserId: string | null = null
      for (const page of pages) {
        try {
          const igResponse = await fetch(
            `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${input.access_token}`
          )
          const igData = await igResponse.json()
          if (igData.instagram_business_account?.id) {
            igUserId = igData.instagram_business_account.id
            break
          }
        } catch (error) {
          console.log(`No Instagram account for page ${page.id}`)
        }
      }
      
      if (!igUserId) {
        return new StepResponse({ synced: 0, message: "No Instagram Business Account found" })
      }

      // Fetch recent media to extract mentions from captions
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${igUserId}/media?fields=caption&limit=50&access_token=${input.access_token}`
      )
      const data = await response.json()

      if (!data.data || data.data.length === 0) {
        return new StepResponse({ synced: 0, message: "No Instagram media found" })
      }

      // Extract mentions from all captions
      const allMentions = new Map<string, number>()
      
      for (const media of data.data) {
        if (media.caption) {
          const mentionMatches = media.caption.match(/@[\w.]+/g) || []
          mentionMatches.forEach((mention: string) => {
            const cleanMention = mention.slice(1).toLowerCase()
            allMentions.set(cleanMention, (allMentions.get(cleanMention) || 0) + 1)
          })
        }
      }

      // Store mentions in database
      let syncedCount = 0
      for (const [username, count] of allMentions.entries()) {
        try {
          const [existing] = await socials.listMentions({ username, platform: "instagram" })
          
          if (existing) {
            await socials.updateMentions([{
              selector: { id: existing.id },
              data: {
                usage_count: existing.usage_count + count,
                last_used_at: new Date(),
              },
            }])
          } else {
            await socials.createMentions({
              username,
              platform: "instagram",
              usage_count: count,
              last_used_at: new Date(),
            })
          }
          syncedCount++
        } catch (error) {
          console.error(`Failed to sync mention @${username}:`, error)
        }
      }

      return new StepResponse({ 
        synced: syncedCount, 
        message: `Synced ${syncedCount} mentions from Instagram` 
      })
    } catch (error) {
      console.error("Error syncing Instagram mentions:", error)
      return new StepResponse({ synced: 0, message: `Error: ${(error as Error).message}` })
    }
  }
)

/**
 * Step to fetch and sync hashtags from Facebook
 * Extracts hashtags from recent page posts
 */
export const syncFacebookHashtagsStep = createStep(
  "sync-facebook-hashtags",
  async (input: SyncPlatformDataInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const fb = new FacebookService()

    try {
      // Get Facebook Pages
      const pages = await fb.listManagedPages(input.access_token)
      
      if (pages.length === 0) {
        return new StepResponse({ synced: 0, message: "No Facebook pages found" })
      }

      const pageId = pages[0].id

      // Fetch recent posts to extract hashtags
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/feed?fields=message&limit=50&access_token=${input.access_token}`
      )
      const data = await response.json()

      if (!data.data) {
        return new StepResponse({ synced: 0, message: "No posts found" })
      }

      // Extract hashtags from all posts
      const allHashtags = new Map<string, number>()
      
      for (const post of data.data) {
        if (post.message) {
          const hashtagMatches = post.message.match(/#[\p{L}\p{N}_]+/gu) || []
          hashtagMatches.forEach((tag: string) => {
            const cleanTag = tag.slice(1).toLowerCase()
            allHashtags.set(cleanTag, (allHashtags.get(cleanTag) || 0) + 1)
          })
        }
      }

      // Store hashtags in database
      let syncedCount = 0
      for (const [tag, count] of allHashtags.entries()) {
        try {
          const [existing] = await socials.listHashtags({ tag, platform: "facebook" })
          
          if (existing) {
            await socials.updateHashtags([{
              selector: { id: existing.id },
              data: {
                usage_count: existing.usage_count + count,
                last_used_at: new Date(),
              },
            }])
          } else {
            await socials.createHashtags({
              tag,
              platform: "facebook",
              usage_count: count,
              last_used_at: new Date(),
            })
          }
          syncedCount++
        } catch (error) {
          console.error(`Failed to sync hashtag #${tag}:`, error)
        }
      }

      return new StepResponse({ 
        synced: syncedCount, 
        message: `Synced ${syncedCount} hashtags from Facebook` 
      })
    } catch (error) {
      console.error("Error syncing Facebook hashtags:", error)
      return new StepResponse({ synced: 0, message: `Error: ${error.message}` })
    }
  }
)

/**
 * Workflow to sync hashtags and mentions from social platforms
 */
export const syncPlatformHashtagsMentionsWorkflow = createWorkflow(
  "sync-platform-hashtags-mentions",
  (input: SyncPlatformDataInput) => {
    const instagramHashtags = syncInstagramHashtagsStep(input)
    const instagramMentions = syncInstagramMentionsStep(input)
    const facebookHashtags = syncFacebookHashtagsStep(input)

    return new WorkflowResponse({
      instagram_hashtags: instagramHashtags,
      instagram_mentions: instagramMentions,
      facebook_hashtags: facebookHashtags,
    })
  }
)
