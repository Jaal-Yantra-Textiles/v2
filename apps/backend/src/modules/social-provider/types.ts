export interface TwitterProviderConfig {
  clientId?: string
  clientSecret?: string
  apiKey?: string
  apiSecret?: string
}

export interface PinterestProviderConfig {
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  scope?: string
}

export interface TwitterAppToken {
  token: string
  expiresAt: number
}

export interface TwitterOAuth1RequestToken {
  oauth_token: string
  oauth_token_secret: string
}

export interface TwitterOAuth1AccessToken {
  oauth_token: string
  oauth_token_secret: string
  user_id: string
  screen_name: string
}

export interface OAuth2Token {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  token_type: string
  retrieved_at: number | Date
}

export interface TwitterOAuth2Token extends OAuth2Token {
  token_type: "bearer"
  scope: string
}

export interface TwitterUserToken {
  access_token: string
  refresh_token?: string
  expires_in: number
}

// Content Publishing Types
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
  pageId: string
  igUserId?: string
  content: {
    type: ContentType
    message?: string
    caption?: string
    image_url?: string
    image_urls?: string[]
    video_url?: string
    /** Reels options (Instagram). */
    reel?: ReelOptions
    link?: string
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
  /** The publish-instagram-reel workflow handling this Reel. */
  transactionId?: string
}

export interface PublishResponse {
  results: PublishResult[]
  allSucceeded: boolean
}
