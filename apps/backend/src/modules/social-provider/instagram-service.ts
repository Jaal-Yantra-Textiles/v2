import { MedusaError } from "@medusajs/utils"

/**
 * InstagramService - Instagram Graph API via Facebook Login
 * 
 * This service uses Facebook's Graph API to manage Instagram Business accounts.
 * Authentication is handled through Facebook Login (not Instagram OAuth).
 * 
 * Requirements:
 * - Instagram account must be Business or Creator type
 * - Instagram account must be linked to a Facebook Page
 * - Use Facebook access token (from FacebookService)
 * 
 * All methods use Facebook Graph API v24.0
 */
export default class InstagramService {
  constructor() {
    // No client credentials needed - uses Facebook tokens
  }

  // ----- Instagram Graph API Methods (via Facebook) -----

  async getLinkedIgAccounts(userAccessToken: string): Promise<Array<{ id: string; username?: string; page_id?: string }>> {
    if (!userAccessToken) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing user access token")
    }
    
    // Step 1: Get all pages the user manages
    // Following official docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started
    const pagesUrl = new URL("https://graph.facebook.com/v24.0/me/accounts")
    pagesUrl.searchParams.set("access_token", userAccessToken)
    
    const pagesResp = await fetch(pagesUrl.toString())
    if (!pagesResp.ok) {
      const err = await pagesResp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA, 
        `Failed to fetch Facebook pages: ${pagesResp.status} - ${JSON.stringify(err)}`
      )
    }
    
    const pagesData = (await pagesResp.json()) as { 
      data?: Array<{ id: string; name?: string; access_token?: string }> 
    }
    
    const pages = pagesData.data || []
    const igs: Array<{ id: string; username?: string; page_id?: string }> = []
    
    // Step 2: For each page, check if it has a linked Instagram Business Account
    // Following official docs: GET /{page-id}?fields=instagram_business_account
    for (const page of pages) {
      try {
        const igUrl = new URL(`https://graph.facebook.com/v24.0/${page.id}`)
        igUrl.searchParams.set("fields", "instagram_business_account{id,username}")
        igUrl.searchParams.set("access_token", userAccessToken)
        
        const igResp = await fetch(igUrl.toString())
        if (igResp.ok) {
          const igData = (await igResp.json()) as { 
            instagram_business_account?: { id: string; username?: string } 
          }
          
          if (igData.instagram_business_account?.id) {
            igs.push({
              id: igData.instagram_business_account.id,
              username: igData.instagram_business_account.username,
              page_id: page.id,
            })
          }
        }
        // If a specific page fails, continue with others
      } catch (e) {
        console.warn(`Failed to fetch IG account for page ${page.id}:`, (e as Error).message)
      }
    }
    
    return igs
  }

  async createContainer(
    igUserId: string,
    payload: { image_url?: string; video_url?: string; caption?: string; media_type?: "REELS" | "CAROUSEL" },
    accessToken: string
  ): Promise<{ id: string }> {
    if (!igUserId || !accessToken) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing igUserId or accessToken")
    }
    const url = `https://graph.facebook.com/v24.0/${encodeURIComponent(igUserId)}/media`
    const body = new URLSearchParams()
    if (payload.image_url) body.set("image_url", payload.image_url)
    if (payload.video_url) body.set("video_url", payload.video_url)
    if (payload.caption) body.set("caption", payload.caption)
    if (payload.media_type) body.set("media_type", payload.media_type)
    body.set("access_token", accessToken)
    const resp = await fetch(url, { method: "POST", body })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      
      // Provide helpful error message for aspect ratio issues
      const errorMsg = err?.error?.message || ""
      const errorCode = err?.error?.code
      if (errorCode === 36003 || errorMsg.toLowerCase().includes("aspect ratio")) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Instagram rejected the image due to invalid aspect ratio. Instagram requires images with aspect ratios between 4:5 (portrait) and 1.91:1 (landscape). Please resize your image and try again. Original error: ${errorMsg}`
        )
      }
      
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `IG create container failed: ${resp.status} - ${JSON.stringify(err)}`)
    }
    return (await resp.json()) as { id: string }
  }

  /**
   * Check the status of a media container
   * Status codes: IN_PROGRESS, FINISHED, ERROR, EXPIRED
   */
  async checkContainerStatus(
    containerId: string,
    accessToken: string
  ): Promise<{ status_code: string; status?: string }> {
    const url = new URL(`https://graph.facebook.com/v24.0/${encodeURIComponent(containerId)}`)
    url.searchParams.set("fields", "status_code,status")
    url.searchParams.set("access_token", accessToken)
    
    const resp = await fetch(url.toString())
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Failed to check container status: ${resp.status} - ${JSON.stringify(err)}`
      )
    }
    return (await resp.json()) as { status_code: string; status?: string }
  }

  /**
   * Wait for a container to be ready for publishing
   * Polls the container status until it's FINISHED or times out
   * 
   * @param containerId - The container ID to check
   * @param accessToken - Access token
   * @param maxAttempts - Maximum number of polling attempts (default: 30)
   * @param delayMs - Delay between attempts in ms (default: 2000 = 2 seconds)
   */
  async waitForContainerReady(
    containerId: string,
    accessToken: string,
    maxAttempts: number = 30,
    delayMs: number = 2000
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const status = await this.checkContainerStatus(containerId, accessToken)
      
      console.log(`[Instagram] Container ${containerId} status check ${attempt}/${maxAttempts}: ${status.status_code}`)
      
      if (status.status_code === "FINISHED") {
        return // Ready to publish
      }
      
      if (status.status_code === "ERROR") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Instagram container processing failed: ${status.status || "Unknown error"}`
        )
      }
      
      if (status.status_code === "EXPIRED") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Instagram container expired before publishing"
        )
      }
      
      // Still IN_PROGRESS, wait and retry
      if (attempt < maxAttempts) {
        await this.delay(delayMs)
      }
    }
    
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Instagram container not ready after ${maxAttempts} attempts (${(maxAttempts * delayMs) / 1000}s). Please try again.`
    )
  }

  /**
   * Helper to create a delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async publishContainer(igUserId: string, creationId: string, accessToken: string): Promise<{ id: string }> {
    // Wait for container to be ready before publishing
    await this.waitForContainerReady(creationId, accessToken)
    
    const url = `https://graph.facebook.com/v24.0/${encodeURIComponent(igUserId)}/media_publish`
    const body = new URLSearchParams()
    body.set("creation_id", creationId)
    body.set("access_token", accessToken)
    const resp = await fetch(url, { method: "POST", body })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `IG publish failed: ${resp.status} - ${JSON.stringify(err)}`)
    }
    return (await resp.json()) as { id: string }
  }

  async publishImage(igUserId: string, args: { image_url: string; caption?: string }, accessToken: string) {
    const cont = await this.createContainer(igUserId, { image_url: args.image_url, caption: args.caption }, accessToken)
    return this.publishContainer(igUserId, cont.id, accessToken)
  }

  async publishVideoAsReel(igUserId: string, args: { video_url: string; caption?: string }, accessToken: string) {
    const cont = await this.createContainer(igUserId, { video_url: args.video_url, caption: args.caption, media_type: "REELS" }, accessToken)
    return this.publishContainer(igUserId, cont.id, accessToken)
  }

  /**
   * Publish a carousel post with multiple images (up to 10)
   * 
   * Instagram carousel flow:
   * 1. Create a container for each image
   * 2. Create a carousel container with all child container IDs
   * 3. Publish the carousel container
   * 
   * @param igUserId - Instagram Business Account ID
   * @param args - Carousel data with image URLs and caption
   * @param accessToken - Page access token
   * @returns Published media ID and permalink
   */
  async publishCarousel(
    igUserId: string, 
    args: { image_urls: string[]; caption?: string }, 
    accessToken: string
  ): Promise<{ id: string; permalink?: string }> {
    if (!args.image_urls || args.image_urls.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "At least one image is required for carousel")
    }

    if (args.image_urls.length > 10) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Instagram carousels support maximum 10 images")
    }

    // Step 1: Create a container for each image
    const childContainerIds: string[] = []
    
    for (const imageUrl of args.image_urls) {
      const container = await this.createContainer(
        igUserId,
        { 
          image_url: imageUrl,
          // Note: Caption is only on the carousel container, not individual items
        },
        accessToken
      )
      childContainerIds.push(container.id)
    }

    // Step 2: Create the carousel container
    const carouselUrl = `https://graph.facebook.com/v24.0/${encodeURIComponent(igUserId)}/media`
    const carouselBody = new URLSearchParams()
    carouselBody.set("media_type", "CAROUSEL")
    carouselBody.set("children", childContainerIds.join(","))
    if (args.caption) {
      carouselBody.set("caption", args.caption)
    }
    carouselBody.set("access_token", accessToken)

    const carouselResp = await fetch(carouselUrl, { method: "POST", body: carouselBody })
    if (!carouselResp.ok) {
      const err = await carouselResp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA, 
        `IG carousel container creation failed: ${carouselResp.status} - ${JSON.stringify(err)}`
      )
    }

    const carouselContainer = (await carouselResp.json()) as { id: string }

    // Step 3: Publish the carousel
    const published = await this.publishContainer(igUserId, carouselContainer.id, accessToken)

    // Get permalink
    const permalink = await this.getMediaPermalink(published.id, accessToken)

    return {
      id: published.id,
      permalink,
    }
  }

  async getMediaPermalink(mediaId: string, accessToken: string): Promise<string | undefined> {
    const url = new URL(`https://graph.facebook.com/v24.0/${encodeURIComponent(mediaId)}`)
    url.searchParams.set("fields", "permalink")
    url.searchParams.set("access_token", accessToken)
    const resp = await fetch(url.toString())
    if (!resp.ok) return undefined
    const data = (await resp.json()) as { permalink?: string }
    return data.permalink
  }
}
