import { MedusaError } from "@medusajs/utils"
import FacebookService from "./facebook-service"
import InstagramService from "./instagram-service"
import { transformForInstagram, transformForFacebook } from "./image-transformer"

export type ContentType = "photo" | "video" | "text" | "reel" | "carousel"

/** Instagram Reels options, from a post's `metadata.reel`. */
export interface ReelOptions {
  /** Also show the Reel on the profile grid. Instagram's default is true. */
  share_to_feed?: boolean
  /** Public image URL for the cover. */
  cover_url?: string
  /** Cover frame, in milliseconds from the start, when no cover_url. */
  thumb_offset?: number
}
export type Platform = "facebook" | "instagram" | "both"

export interface PublishContentInput {
  platform: Platform
  pageId: string // Facebook Page ID (required for both platforms)
  igUserId?: string // Instagram Business Account ID (required for Instagram)
  content: {
    type: ContentType
    message?: string
    caption?: string // For Instagram
    image_url?: string // Single image (for backward compatibility)
    image_urls?: string[] // Multiple images for carousel/album
    video_url?: string
    /** Reels options (Instagram). */
    reel?: ReelOptions
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
  /**
   * Instagram Reels only: the container was created but Instagram is still
   * processing the video. Not a failure — the finish-instagram-reels job
   * publishes it once FINISHED.
   */
  pending?: boolean
  containerId?: string
  igUserId?: string
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
  /**
   * How long a Reel may process inside the publish request before it is
   * handed to the finish-instagram-reels job: 12 × 5 s = 60 s.
   */
  reelWait = { attempts: 12, delayMs: 5000 }

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

    // Get page access token only if publishing to Facebook
    let pageAccessToken: string | undefined
    if (input.platform === "facebook" || input.platform === "both") {
      try {
        pageAccessToken = await this.facebookService.getPageAccessToken(
          input.pageId!,
          input.userAccessToken
        )
      } catch (error) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Failed to get page access token: ${error.message}`
        )
      }
    }

    // Publish to Facebook
    if (input.platform === "facebook" || input.platform === "both") {
      const fbResult = await this.publishToFacebook(input, pageAccessToken!)
      results.push(fbResult)
    }

    // Publish to Instagram
    if (input.platform === "instagram" || input.platform === "both") {
      // For Instagram, use page access token if available (for "both"), otherwise use user token
      const igToken = pageAccessToken || input.userAccessToken
      const igResult = await this.publishToInstagram(input, igToken)
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

        case "carousel":
          // For Facebook, carousel = multi-photo album
          if (!input.content.image_urls || input.content.image_urls.length === 0) {
            throw new Error("image_urls is required for carousel posts")
          }
          response = await this.facebookService.createPagePhotoAlbum(
            input.pageId,
            {
              message: input.content.message,
              image_urls: input.content.image_urls,
            },
            pageAccessToken
          )
          break

        case "video":
        case "reel":
          if (!input.content.video_url) {
            throw new Error("video_url is required for video posts")
          }
          response = await this.facebookService.createPageVideoPost(
            input.pageId,
            {
              description: input.content.message,
              file_url: input.content.video_url,
            },
            pageAccessToken
          )
          break

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
          // Transform image to Instagram-compatible aspect ratio (1:1 square)
          const transformedImageUrl = transformForInstagram(input.content.image_url, "square")
          response = await this.instagramService.publishImage(
            input.igUserId,
            {
              image_url: transformedImageUrl,
              caption,
            },
            pageAccessToken
          )
          break

        case "carousel":
          if (!input.content.image_urls || input.content.image_urls.length === 0) {
            throw new Error("image_urls is required for carousel posts")
          }
          // Transform all images to Instagram-compatible aspect ratio
          const transformedImageUrls = input.content.image_urls.map(url => 
            transformForInstagram(url, "square")
          )
          response = await this.instagramService.publishCarousel(
            input.igUserId,
            {
              image_urls: transformedImageUrls,
              caption,
            },
            pageAccessToken
          )
          break

        case "video":
        case "reel": {
          if (!input.content.video_url) {
            throw new Error("video_url is required for video/reel posts")
          }
          // Reels: create the container, give Instagram up to ~60 s to process
          // the video inside this request, then hand off. The publish request
          // goes through Cloudflare (≈100 s cap), and Reels often take minutes,
          // so a still-processing Reel is returned as PENDING (not failed) and
          // the finish-instagram-reels job publishes it.
          const reel = input.content.reel || {}
          const container = await this.instagramService.startReel(
            input.igUserId,
            {
              video_url: input.content.video_url,
              caption,
              share_to_feed: reel.share_to_feed,
              cover_url: reel.cover_url,
              thumb_offset: reel.thumb_offset,
            },
            pageAccessToken
          )
          const status = await this.instagramService.pollContainer(
            container.id,
            pageAccessToken,
            this.reelWait
          )
          if (status.status_code === "IN_PROGRESS") {
            return {
              platform: "instagram",
              success: false,
              pending: true,
              containerId: container.id,
              igUserId: input.igUserId,
            }
          }
          if (status.status_code !== "FINISHED") {
            throw new Error(
              `Instagram could not process the Reel video (${status.status_code}${status.status ? `: ${status.status}` : ""})`
            )
          }
          response = await this.instagramService.publishReadyContainer(
            input.igUserId,
            container.id,
            pageAccessToken
          )
          break
        }

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
