import { MedusaError } from "@medusajs/utils"
import FacebookService from "./facebook-service"
import InstagramService from "./instagram-service"

export type ContentType = "photo" | "video" | "text" | "reel"
export type Platform = "facebook" | "instagram" | "both"

export interface PublishContentInput {
  platform: Platform
  pageId: string // Facebook Page ID (required for both platforms)
  igUserId?: string // Instagram Business Account ID (required for Instagram)
  content: {
    type: ContentType
    message?: string
    caption?: string // For Instagram
    image_url?: string
    video_url?: string
    link?: string // For Facebook text posts
  }
  userAccessToken: string
}

export interface PublishResult {
  platform: "facebook" | "instagram"
  success: boolean
  postId?: string
  permalink?: string
  error?: string
}

export interface PublishResponse {
  results: PublishResult[]
  allSucceeded: boolean
}

/**
 * ContentPublishingService - Unified service for publishing content to Facebook and Instagram
 * 
 * This service orchestrates content publishing across both platforms using the same
 * Facebook Page access token. Instagram Business accounts must be linked to a Facebook Page.
 * 
 * Publishing Flow:
 * 1. Get Page Access Token from User Access Token
 * 2. Route to appropriate platform service(s)
 * 3. Return unified results
 */
export default class ContentPublishingService {
  private facebookService: FacebookService
  private instagramService: InstagramService

  constructor() {
    this.facebookService = new FacebookService()
    this.instagramService = new InstagramService()
  }

  /**
   * Publish content to one or both platforms
   */
  async publishContent(input: PublishContentInput): Promise<PublishResponse> {
    this.validateInput(input)

    const results: PublishResult[] = []

    // Get page access token (works for both platforms)
    let pageAccessToken: string
    try {
      pageAccessToken = await this.facebookService.getPageAccessToken(
        input.pageId,
        input.userAccessToken
      )
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Failed to get page access token: ${error.message}`
      )
    }

    // Publish to Facebook
    if (input.platform === "facebook" || input.platform === "both") {
      const fbResult = await this.publishToFacebook(input, pageAccessToken)
      results.push(fbResult)
    }

    // Publish to Instagram
    if (input.platform === "instagram" || input.platform === "both") {
      const igResult = await this.publishToInstagram(input, pageAccessToken)
      results.push(igResult)
    }

    return {
      results,
      allSucceeded: results.every((r) => r.success),
    }
  }

  /**
   * Publish content to Facebook Page
   */
  private async publishToFacebook(
    input: PublishContentInput,
    pageAccessToken: string
  ): Promise<PublishResult> {
    try {
      let response: any

      switch (input.content.type) {
        case "photo":
          if (!input.content.image_url) {
            throw new Error("image_url is required for photo posts")
          }
          response = await this.facebookService.createPagePhotoPost(
            input.pageId,
            {
              message: input.content.message,
              image_url: input.content.image_url,
            },
            pageAccessToken
          )
          break

        case "video":
          // Facebook video posts would go here (not yet implemented in FacebookService)
          throw new Error("Video posts not yet implemented for Facebook")

        case "text":
          if (!input.content.message) {
            throw new Error("message is required for text posts")
          }
          response = await this.facebookService.createPageFeedPost(
            input.pageId,
            {
              message: input.content.message,
              link: input.content.link,
            },
            pageAccessToken
          )
          break

        default:
          throw new Error(`Unsupported content type for Facebook: ${input.content.type}`)
      }

      return {
        platform: "facebook",
        success: true,
        postId: response.id || response.post_id,
      }
    } catch (error) {
      return {
        platform: "facebook",
        success: false,
        error: error.message,
      }
    }
  }

  /**
   * Publish content to Instagram Business Account
   */
  private async publishToInstagram(
    input: PublishContentInput,
    pageAccessToken: string
  ): Promise<PublishResult> {
    try {
      if (!input.igUserId) {
        throw new Error("igUserId is required for Instagram publishing")
      }

      let response: any
      const caption = input.content.caption || input.content.message

      switch (input.content.type) {
        case "photo":
          if (!input.content.image_url) {
            throw new Error("image_url is required for photo posts")
          }
          response = await this.instagramService.publishImage(
            input.igUserId,
            {
              image_url: input.content.image_url,
              caption,
            },
            pageAccessToken
          )
          break

        case "video":
        case "reel":
          if (!input.content.video_url) {
            throw new Error("video_url is required for video/reel posts")
          }
          response = await this.instagramService.publishVideoAsReel(
            input.igUserId,
            {
              video_url: input.content.video_url,
              caption,
            },
            pageAccessToken
          )
          break

        case "text":
          throw new Error("Instagram does not support text-only posts")

        default:
          throw new Error(`Unsupported content type for Instagram: ${input.content.type}`)
      }

      // Try to get permalink
      let permalink: string | undefined
      if (response.id) {
        try {
          permalink = await this.instagramService.getMediaPermalink(
            response.id,
            pageAccessToken
          )
        } catch {
          // Permalink fetch failed, continue without it
        }
      }

      return {
        platform: "instagram",
        success: true,
        postId: response.id,
        permalink,
      }
    } catch (error) {
      return {
        platform: "instagram",
        success: false,
        error: error.message,
      }
    }
  }

  /**
   * Get linked Instagram Business accounts for a user
   */
  async getLinkedInstagramAccounts(userAccessToken: string) {
    return this.instagramService.getLinkedIgAccounts(userAccessToken)
  }

  /**
   * Get managed Facebook Pages for a user
   */
  async getManagedFacebookPages(userAccessToken: string) {
    return this.facebookService.listManagedPages(userAccessToken)
  }

  /**
   * Get both Facebook Pages and linked Instagram accounts
   */
  async getManagedAccounts(userAccessToken: string) {
    const [pages, igAccounts] = await Promise.all([
      this.getManagedFacebookPages(userAccessToken),
      this.getLinkedInstagramAccounts(userAccessToken),
    ])

    return {
      facebook_pages: pages,
      instagram_accounts: igAccounts,
    }
  }

  /**
   * Validate input before publishing
   */
  private validateInput(input: PublishContentInput): void {
    if (!input.userAccessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "userAccessToken is required"
      )
    }

    if (!input.platform) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "platform is required"
      )
    }

    // Validate pageId only for Facebook or both platforms
    if (
      (input.platform === "facebook" || input.platform === "both") &&
      !input.pageId
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "pageId is required when publishing to Facebook"
      )
    }

    // Validate igUserId only for Instagram or both platforms
    if (
      (input.platform === "instagram" || input.platform === "both") &&
      !input.igUserId
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "igUserId is required when publishing to Instagram"
      )
    }

    if (!input.content || !input.content.type) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "content.type is required"
      )
    }
  }
}
