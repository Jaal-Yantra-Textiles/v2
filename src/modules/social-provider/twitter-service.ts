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
  initiateUserAuth(redirectUri: string, scope: string = "tweet.write offline.access") {
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

  private async ensureClient() {
    if (!this.twitterClient) {
      await this.getAppBearerToken()
    }
  }
}
