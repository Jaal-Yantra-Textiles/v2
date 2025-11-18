import { Client as TwitterClient } from "twitter-api-sdk"
import crypto from "crypto"
import {
  OAuth2Token,
  TwitterOAuth2Token,
  TwitterUserToken,
  TwitterAppToken,
  TwitterProviderConfig
} from "./types"
import { MedusaError } from "@medusajs/utils"

export default class TwitterService {
  protected readonly config: TwitterProviderConfig

  constructor(options?: Partial<TwitterProviderConfig>) {
    this.config = {
      clientId: options?.clientId || process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || "",
      clientSecret: options?.clientSecret || process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || "",
      apiKey: options?.apiKey || process.env.X_API_KEY || process.env.TWITTER_API_KEY || "",
      apiSecret: options?.apiSecret || process.env.X_API_SECRET || process.env.TWITTER_API_SECRET || "",
    }
    const hasOAuthPair = this.config.clientId && this.config.clientSecret
    const hasAppPair = this.config.apiKey && this.config.apiSecret
    if (!hasOAuthPair && !hasAppPair) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "TwitterService: provide either (clientId & clientSecret) for user OAuth or (apiKey & apiSecret) for app-only flow"
      )
    }
  }

  /**
   * Perform application-only (client credentials) OAuth 2.0 flow and return a bearer token
   */
  private cachedToken: TwitterAppToken | null = null
  private twitterClient: TwitterClient | null = null

  async getAppBearerToken(): Promise<TwitterAppToken> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken
    }

    const { apiKey, apiSecret } = this.config
    const creds = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")
    const body = new URLSearchParams({ grant_type: "client_credentials" })

    const response = await fetch("https://api.x.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        `Twitter token request failed: ${response.status}`
      )
    }

    const data = (await response.json()) as { access_token: string; expires_in?: number };

    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    }
    this.twitterClient = new TwitterClient(this.cachedToken.token)
    return this.cachedToken
  }



  /** ---------- OAuth 2.0 user helpers (PKCE) ---------- */
  private static pkceStore: Map<string, string> = new Map()

  private generatePkcePair() {
    const codeVerifier = crypto.randomBytes(32).toString("hex")
    const hash = crypto.createHash("sha256").update(codeVerifier).digest()
    const codeChallenge = hash.toString("base64url")
    return { codeVerifier, codeChallenge }
  }

  /** Build the OAuth2 authorization URL and return verifier/challenge */
  initiateUserAuth(redirectUri: string, scope: string = "tweet.read tweet.write users.read offline.access") {
    const { codeVerifier, codeChallenge } = this.generatePkcePair();
    const state = crypto.randomBytes(16).toString("hex");
    console.log(`[Twitter Service] Initiating OAuth with redirect URI: ${redirectUri}`);
    const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${this.config.clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    TwitterService.pkceStore.set(state, codeVerifier);
    console.log(`[Twitter Service] Auth URL: ${authUrl}`);
    return { authUrl, state };
}

async exchangeCodeForToken(code: string, redirectUri: string, state: string) {
  console.log(`[Twitter Service] Exchanging code for token`);
  console.log(`[Twitter Service] Redirect URI: ${redirectUri}`);
  console.log(`[Twitter Service] State: ${state}`);
  const codeVerifier = TwitterService.pkceStore.get(state);
  if (!codeVerifier) {
      console.error(`[Twitter Service] No code verifier found for state: ${state}`);
      throw new MedusaError(
          MedusaError.Types.INVALID_ARGUMENT,
          `No code verifier found for state ${state}`
      );
  }

  const isConfidential = !!this.config.clientSecret

  const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
  })

  if (!isConfidential) {
      body.append("client_id", this.config.clientId || "")
  }

  const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
  }

  if (isConfidential) {
      const authHeader = Buffer.from(
        `${this.config.clientId || ""}:${this.config.clientSecret}`
      ).toString("base64")
      headers.Authorization = `Basic ${authHeader}`
  }

  const resp = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body: body.toString(),
  })

  if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));

      throw new MedusaError(
          MedusaError.Types.INVALID_ARGUMENT,
          `OAuth2 token exchange failed: ${resp.status} - ${JSON.stringify(errorData)}`
      );
  }

  const tokenResponse = await resp.json();
  // Optional: Validate response shape
  if (!tokenResponse.access_token) {
      throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Invalid token response: missing access_token"
      );
  }

  TwitterService.pkceStore.delete(state); // Clean up PKCE store
  return tokenResponse as import("./types").TwitterOAuth2Token;
}

async refreshAccessToken(refreshToken: string): Promise<OAuth2Token> {
  const isConfidential = !!this.config.clientSecret;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  if (!isConfidential) {
    body.append("client_id", this.config.clientId || "");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (isConfidential) {
    const authHeader = Buffer.from(
      `${this.config.clientId || ""}:${this.config.clientSecret}`
    ).toString("base64");
    headers.Authorization = `Basic ${authHeader}`;
  }

  const resp = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: body.toString(),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      `OAuth2 token refresh failed: ${resp.status} - ${JSON.stringify(
        errorData
      )}`
    );
  }

  return (await resp.json()) as import("./types").TwitterOAuth2Token;
}

  /**
   * Get authenticated user's profile information
   * @param accessToken - OAuth 2.0 access token
   */
  async getUserProfile(accessToken: string) {
    const response = await fetch("https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url,description,verified", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const error = await response.json()
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Failed to fetch Twitter user profile: ${response.status} - ${JSON.stringify(error)}`
      )
    }

    const data = await response.json()
    return data.data // Returns { id, name, username, profile_image_url, description, verified }
  }

  /**
   * Example helper using the SDK – fetch a tweet by id (app-only)
   */
  async getTweet(id: string) {
    await this.ensureClient()
    return this.twitterClient!.tweets.findTweetById(id)
  }

  /**
   * Upload media to Twitter using X API v2
   * Supports both simple (images) and chunked (videos) uploads
   * 
   * @param imageUrl - Public URL of the media to upload
   * @param accessToken - OAuth 2.0 bearer token (user context)
   * @returns media_id for use in tweet creation
   */
  async uploadMedia(
    imageUrl: string,
    accessToken: string
  ): Promise<string> {
    // Download media from URL
    const mediaResponse = await fetch(imageUrl)
    if (!mediaResponse.ok) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Failed to download media from ${imageUrl}: ${mediaResponse.status}`
      )
    }

    const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer())
    const contentType = mediaResponse.headers.get('content-type') || 'image/jpeg'
    const isVideo = contentType.startsWith('video/')
    const totalBytes = mediaBuffer.length

    // Determine media category
    let mediaCategory = 'tweet_image'
    if (isVideo) {
      mediaCategory = 'tweet_video'
    } else if (contentType === 'image/gif') {
      mediaCategory = 'tweet_gif'
    }

    const MEDIA_ENDPOINT_URL = 'https://api.x.com/2/media/upload'
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'MedusaJS-Social-Publisher',
    }

    // For images, use simple upload with base64
    if (!isVideo && totalBytes <= 5 * 1024 * 1024) {
      // Simple upload for images <= 5MB
      const base64Media = mediaBuffer.toString('base64')
      
      const formData = new URLSearchParams()
      formData.append('media_data', base64Media)
      formData.append('media_category', mediaCategory)

      const uploadResponse = await fetch(MEDIA_ENDPOINT_URL, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Transfer-Encoding': 'base64',
        },
        body: formData.toString(),
      })

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json().catch(() => ({}))
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Media upload failed: ${uploadResponse.status} - ${JSON.stringify(errorData)}`
        )
      }

      const uploadData = (await uploadResponse.json()) as { data: { id: string } }
      return uploadData.data.id
    }

    // For videos or large files, use chunked upload (INIT -> APPEND -> FINALIZE)
    // INIT
    const initResponse = await fetch(MEDIA_ENDPOINT_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: 'INIT',
        media_type: contentType,
        total_bytes: totalBytes,
        media_category: mediaCategory,
      }),
    })

    if (!initResponse.ok) {
      const errorData = await initResponse.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Media upload INIT failed: ${initResponse.status} - ${JSON.stringify(errorData)}`
      )
    }

    const initData = (await initResponse.json()) as { data: { id: string } }
    const mediaId = initData.data.id

    // APPEND - Upload in 4MB chunks
    const chunkSize = 4 * 1024 * 1024
    let segmentIndex = 0
    let bytesSent = 0

    while (bytesSent < totalBytes) {
      const chunk = mediaBuffer.slice(bytesSent, Math.min(bytesSent + chunkSize, totalBytes))
      
      const formData = new FormData()
      formData.append('command', 'APPEND')
      formData.append('media_id', mediaId)
      formData.append('segment_index', segmentIndex.toString())
      formData.append('media', new Blob([chunk], { type: 'application/octet-stream' }), 'chunk')

      const appendResponse = await fetch(MEDIA_ENDPOINT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'MedusaJS-Social-Publisher',
        },
        body: formData as any,
      })

      if (!appendResponse.ok) {
        const errorData = await appendResponse.json().catch(() => ({}))
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Media upload APPEND failed: ${appendResponse.status} - ${JSON.stringify(errorData)}`
        )
      }

      segmentIndex++
      bytesSent += chunk.length
    }

    // FINALIZE
    const finalizeResponse = await fetch(MEDIA_ENDPOINT_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: 'FINALIZE',
        media_id: mediaId,
      }),
    })

    if (!finalizeResponse.ok) {
      const errorData = await finalizeResponse.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Media upload FINALIZE failed: ${finalizeResponse.status} - ${JSON.stringify(errorData)}`
      )
    }

    const finalizeData = (await finalizeResponse.json()) as { data: { id: string, processing_info?: any } }
    
    // Check if processing is required (for videos)
    if (finalizeData.data.processing_info) {
      await this.waitForProcessing(mediaId, accessToken)
    }

    return mediaId
  }

  /**
   * Wait for video processing to complete
   */
  private async waitForProcessing(mediaId: string, accessToken: string): Promise<void> {
    const MEDIA_ENDPOINT_URL = 'https://api.x.com/2/media/upload'
    const maxAttempts = 60
    let attempts = 0

    while (attempts < maxAttempts) {
      const statusResponse = await fetch(MEDIA_ENDPOINT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'MedusaJS-Social-Publisher',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: 'STATUS',
          media_id: mediaId,
        }),
      })

      if (!statusResponse.ok) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Media processing status check failed: ${statusResponse.status}`
        )
      }

      const statusData = (await statusResponse.json()) as { data: { processing_info?: any } }
      const processingInfo = statusData.data.processing_info

      if (!processingInfo) {
        return // Processing complete
      }

      const state = processingInfo.state

      if (state === 'succeeded') {
        return
      }

      if (state === 'failed') {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Media processing failed: ${JSON.stringify(processingInfo)}`
        )
      }

      // Wait before checking again
      const checkAfterSecs = processingInfo.check_after_secs || 5
      await new Promise(resolve => setTimeout(resolve, checkAfterSecs * 1000))
      attempts++
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'Media processing timeout'
    )
  }

  /**
   * Create a tweet using OAuth 2.0 (v2 API)
   * 
   * @param content - Tweet content
   * @param accessToken - OAuth 2.0 access token
   * @returns Created tweet data
   */
  async createTweet(
    content: {
      text: string
      mediaIds?: string[]
    },
    accessToken: string
  ): Promise<{
    id: string
    text: string
  }> {
    const payload: any = {
      text: content.text,
    }

    if (content.mediaIds && content.mediaIds.length > 0) {
      payload.media = {
        media_ids: content.mediaIds,
      }
    }

    const response = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Tweet creation failed: ${response.status} - ${JSON.stringify(errorData)}`
      )
    }

    const data = (await response.json()) as { data: { id: string; text: string } }
    return data.data
  }

  /**
   * Publish tweet with media (combines upload + create)
   * 
   * @param content - Tweet content with optional media URLs
   * @param oauth2Token - OAuth 2.0 access token
   * @param oauth1Credentials - OAuth 1.0a credentials for media upload
   * @returns Tweet ID and URL
   */
  async publishTweetWithMedia(
    content: {
      text: string
      imageUrls?: string[]
      videoUrl?: string
    },
    oauth2Token: string,
    oauth1Credentials?: {
      apiKey: string
      apiSecret: string
      accessToken: string | null
      accessTokenSecret: string | null
    }
  ): Promise<{
    tweetId: string
    tweetUrl: string
  }> {
    const mediaIds: string[] = []

    // Upload images if present (using OAuth 2.0 bearer token)
    if (content.imageUrls && content.imageUrls.length > 0) {
      for (const imageUrl of content.imageUrls) {
        const mediaId = await this.uploadMedia(imageUrl, oauth2Token)
        mediaIds.push(mediaId)
      }
    }

    // Upload video if present (using OAuth 2.0 bearer token)
    if (content.videoUrl) {
      const mediaId = await this.uploadMedia(content.videoUrl, oauth2Token)
      mediaIds.push(mediaId)
    }

    // Create tweet
    const tweet = await this.createTweet(
      {
        text: content.text,
        mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
      },
      oauth2Token
    )

    return {
      tweetId: tweet.id,
      tweetUrl: `https://twitter.com/i/web/status/${tweet.id}`,
    }
  }

  /**
   * Get tweet metrics using OAuth 2.0
   * 
   * @param tweetId - Tweet ID
   * @param accessToken - OAuth 2.0 access token
   * @returns Tweet metrics
   */
  async getTweetMetrics(
    tweetId: string,
    accessToken: string
  ): Promise<{
    impressions?: number
    likes: number
    retweets: number
    replies: number
    quotes: number
  }> {
    const response = await fetch(
      `https://api.x.com/2/tweets/${tweetId}?tweet.fields=public_metrics`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Failed to fetch tweet metrics: ${response.status} - ${JSON.stringify(errorData)}`
      )
    }

    const data = (await response.json()) as {
      data: {
        public_metrics: {
          retweet_count: number
          reply_count: number
          like_count: number
          quote_count: number
          impression_count?: number
        }
      }
    }

    return {
      impressions: data.data.public_metrics.impression_count,
      likes: data.data.public_metrics.like_count,
      retweets: data.data.public_metrics.retweet_count,
      replies: data.data.public_metrics.reply_count,
      quotes: data.data.public_metrics.quote_count,
    }
  }

  private async ensureClient() {
    if (!this.twitterClient) {
      await this.getAppBearerToken()
    }
  }
}
