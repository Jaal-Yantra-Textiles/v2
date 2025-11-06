export interface TwitterProviderConfig {
  clientId?: string
  clientSecret?: string
  apiKey?: string
  apiSecret?: string
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
export type ContentType = "photo" | "video" | "text" | "reel"
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
    video_url?: string
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
}

export interface PublishResponse {
  results: PublishResult[]
  allSucceeded: boolean
}
