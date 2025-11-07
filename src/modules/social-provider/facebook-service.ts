import { MedusaError } from "@medusajs/utils";
import { OAuth2Token } from "./types";

interface FacebookAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export default class FacebookService {
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor() {
    this.clientId = process.env.FACEBOOK_CLIENT_ID!; 
    this.clientSecret = process.env.FACEBOOK_CLIENT_SECRET!;
  }

  getAuthUrl(redirectUri: string, scope: string, state?: string): string {
    if (!this.clientId || !redirectUri) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "FacebookService: missing FACEBOOK_CLIENT_ID or redirect URI");
    }
    // Default to Facebook Page permissions + Full Instagram permissions
    // Use comma-separated scopes as required by Facebook OAuth
    const defaultScope = "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,instagram_manage_messages";
    const finalScope = (scope && scope.trim().length > 0) ? scope : defaultScope;
    
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: finalScope,
      response_type: "code",
      state: state || "",
    });
    
    // Note: config_id is for Facebook Login for Business (B2B onboarding)
    // For personal/own account access, don't use config_id
    // Uncomment below if you need B2B customer onboarding flow
    // const configId = process.env.FACEBOOK_CONFIG_ID;
    // if (configId) {
    //   params.set("config_id", configId);
    // }
    
    return `https://www.facebook.com/v24.0/dialog/oauth?${params.toString()}`;
  }

  initiateUserAuth(redirectUri: string, scope: string = "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,instagram_manage_messages") {
    const state = Math.random().toString(36).slice(2)
    const authUrl = this.getAuthUrl(redirectUri, scope, state)
    return { authUrl, state }
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<OAuth2Token> {
    if (!code || !redirectUri) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "FacebookService: missing code or redirect URI");
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      code,
    });
    const response = await fetch(`https://graph.facebook.com/v24.0/oauth/access_token?${params.toString()}`, { method: "GET" })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Facebook token exchange failed: ${response.status} - ${JSON.stringify(err)}`
      )
    }
    const data: FacebookAuthResponse = await response.json();
    
    // Get the granted scopes from the token debug endpoint
    let grantedScope = "";
    try {
      const debugUrl = `https://graph.facebook.com/v24.0/debug_token?input_token=${data.access_token}&access_token=${data.access_token}`;
      const debugResp = await fetch(debugUrl);
      if (debugResp.ok) {
        const debugData = await debugResp.json();
        grantedScope = debugData.data?.scopes?.join(",") || "";
      }
    } catch (e) {
      // Non-fatal: continue without scope info
      console.warn("Failed to fetch granted scopes:", (e as Error).message);
    }
    
    return {
      access_token: data.access_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      scope: grantedScope,
      refresh_token: "",
      retrieved_at: new Date()
    };
  }

  async refreshAccessToken(_refreshToken: string): Promise<OAuth2Token> {
    // Facebook Graph OAuth does not provide a refresh_token; instead, a short-lived
    // access token can be exchanged for a long-lived one using the access token itself.
    // Our refresh workflow expects a refresh_token, so we explicitly mark this unsupported.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "FacebookService: refresh_token is not supported by Facebook Graph OAuth"
    );
  }

  /** List Pages managed by the user represented by the access token */
  async listManagedPages(userAccessToken: string): Promise<Array<{ id: string; name?: string }>> {
    if (!userAccessToken) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "FacebookService: missing userAccessToken")
    }
    const resp = await fetch(`https://graph.facebook.com/v24.0/me/accounts?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`)
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Facebook list pages failed: ${resp.status} - ${JSON.stringify(err)}`
      )
    }
    const data = await resp.json()
    const pages = Array.isArray(data?.data) ? data.data : []
    return pages as Array<{ id: string; name?: string }>
  }

  /** Fetch specific fields for a Page using a user access token */
  async getPageFields<T extends Record<string, any>>(pageId: string, fields: string[], userAccessToken: string): Promise<T> {
    if (!pageId || !userAccessToken) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "FacebookService: missing pageId or userAccessToken")
    }
    const qs = new URLSearchParams({
      fields: fields.join(','),
      access_token: userAccessToken,
    })
    const resp = await fetch(`https://graph.facebook.com/v24.0/${encodeURIComponent(pageId)}?${qs.toString()}`)
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Facebook get page fields failed: ${resp.status} - ${JSON.stringify(err)}`
      )
    }
    return (await resp.json()) as T
  }

  /** Convenience: list managed pages and enrich each with provided fields */
  async listManagedPagesWithFields(userAccessToken: string, fields: string[]): Promise<Array<Record<string, any>>> {
    const pages = await this.listManagedPages(userAccessToken)
    const results: Array<Record<string, any>> = []
    for (const p of pages) {
      try {
        const details = await this.getPageFields<Record<string, any>>(p.id, fields, userAccessToken)
        results.push({ id: p.id, name: p.name, ...details })
      } catch {
        results.push({ id: p.id, name: p.name })
      }
    }
    return results
  }

  /**
   * Use a user access token to retrieve a Page access token for the given pageId.
   */
  async getPageAccessToken(pageId: string, userAccessToken: string): Promise<string> {
    if (!pageId || !userAccessToken) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "FacebookService: missing pageId or userAccessToken")
    }
    const resp = await fetch(
      `https://graph.facebook.com/v24.0/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(userAccessToken)}`,
      { method: "GET" }
    )
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Facebook get page token failed: ${resp.status} - ${JSON.stringify(err)}`
      )
    }
    const data = (await resp.json()) as { access_token?: string }
    if (!data.access_token) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "FacebookService: no access_token returned for page")
    }
    return data.access_token
  }

  /**
   * Publish a photo post to a Facebook Page using a Page access token.
   * Either provide `image_url` (publicly accessible) or previously uploaded media ID.
   */
  async createPagePhotoPost(pageId: string, input: { message?: string; image_url?: string }, pageAccessToken: string) {
    if (!pageId || !pageAccessToken) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "FacebookService: missing pageId or pageAccessToken")
    }
    const body = new URLSearchParams()
    if (input.message) body.set("message", input.message)
    if (input.image_url) body.set("url", input.image_url)
    body.set("access_token", pageAccessToken)

    const resp = await fetch(`https://graph.facebook.com/v24.0/${encodeURIComponent(pageId)}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Facebook create photo post failed: ${resp.status} - ${JSON.stringify(err)}`
      )
    }
    return await resp.json()
  }

  /**
   * Publish a feed post to a Facebook Page using a Page access token.
   * Supports simple text posts and optional link attachment.
   */
  async createPageFeedPost(pageId: string, input: { message: string; link?: string }, pageAccessToken: string) {
    if (!pageId || !pageAccessToken) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "FacebookService: missing pageId or pageAccessToken")
    }
    const body = new URLSearchParams()
    if (input.message) body.set("message", input.message)
    if (input.link) body.set("link", input.link)
    body.set("access_token", pageAccessToken)

    const resp = await fetch(`https://graph.facebook.com/v24.0/${encodeURIComponent(pageId)}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Facebook create feed post failed: ${resp.status} - ${JSON.stringify(err)}`
      )
    }
    return await resp.json()
  }
}
