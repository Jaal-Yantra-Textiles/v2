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
  initiateUserAuth(redirectUri: string, scope: string = "tweet.read tweet.write offline.access") {
    const { codeVerifier, codeChallenge } = this.generatePkcePair();
    const state = crypto.randomBytes(16).toString("hex");
    const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${this.config.clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    TwitterService.pkceStore.set(state, codeVerifier);
    return { authUrl, state };
}

async exchangeCodeForToken(code: string, redirectUri: string, state: string) {
  const codeVerifier = TwitterService.pkceStore.get(state);
  if (!codeVerifier) {
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
   * Example helper using the SDK – fetch a tweet by id (app-only)
   */
  async getTweet(id: string) {
    await this.ensureClient()
    return this.twitterClient!.tweets.findTweetById(id)
  }

  /**
   * Upload media using OAuth 1.0a (v1.1 API)
   * Required for attaching images/videos to tweets
   * 
   * @param imageUrl - Public URL of the image to upload
   * @param oauth1Credentials - OAuth 1.0a credentials
   * @returns media_id_string for use in tweet creation
   */
  async uploadMedia(
    imageUrl: string,
    oauth1Credentials: {
      apiKey: string
      apiSecret: string
      accessToken: string
      accessTokenSecret: string
    }
  ): Promise<string> {
    // Download image from URL
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Failed to download image from ${imageUrl}: ${imageResponse.status}`
      )
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    const base64Image = imageBuffer.toString("base64")

    // Generate OAuth 1.0a signature
    const oauth = {
      oauth_consumer_key: oauth1Credentials.apiKey,
      oauth_token: oauth1Credentials.accessToken,
      oauth_signature_method: "HMAC-SHA256",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_nonce: crypto.randomBytes(32).toString("hex"),
      oauth_version: "1.0",
    }

    // Create signature base string
    const method = "POST"
    const url = "https://upload.twitter.com/1.1/media/upload.json"
    const parameterString = Object.keys(oauth)
      .sort()
      .map((key) => `${key}=${encodeURIComponent(oauth[key as keyof typeof oauth])}`)
      .join("&")

    const signatureBaseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(parameterString)}`

    // Create signing key
    const signingKey = `${encodeURIComponent(oauth1Credentials.apiSecret)}&${encodeURIComponent(oauth1Credentials.accessTokenSecret)}`

    // Generate signature
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(signatureBaseString)
      .digest("base64")

    // Build Authorization header
    const authHeader = `OAuth ${Object.entries({ ...oauth, oauth_signature: signature })
      .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
      .join(", ")}`

    // Upload media
    const formData = new URLSearchParams()
    formData.append("media_data", base64Image)

    const uploadResponse = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
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

    const uploadData = (await uploadResponse.json()) as { media_id_string: string }
    return uploadData.media_id_string
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
    oauth1Credentials: {
      apiKey: string
      apiSecret: string
      accessToken: string
      accessTokenSecret: string
    }
  ): Promise<{
    tweetId: string
    tweetUrl: string
  }> {
    const mediaIds: string[] = []

    // Upload images if present
    if (content.imageUrls && content.imageUrls.length > 0) {
      for (const imageUrl of content.imageUrls) {
        const mediaId = await this.uploadMedia(imageUrl, oauth1Credentials)
        mediaIds.push(mediaId)
      }
    }

    // Upload video if present
    if (content.videoUrl) {
      const mediaId = await this.uploadMedia(content.videoUrl, oauth1Credentials)
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
