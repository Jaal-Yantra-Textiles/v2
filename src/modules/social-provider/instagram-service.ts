import { MedusaError } from "@medusajs/utils"
import { OAuth2Token } from "./types"


export default class InstagramService {
  private readonly clientId: string
  private readonly clientSecret: string

  constructor() {
    this.clientId = process.env.INSTAGRAM_CLIENT_ID || ""
    this.clientSecret = process.env.INSTAGRAM_CLIENT_SECRET || ""
  }

  getAuthUrl(redirectUri: string, scope: string, state?: string): string {
    if (!this.clientId || !redirectUri) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "InstagramService: missing INSTAGRAM_CLIENT_ID or redirect URI"
      )
    }
    const finalScope = scope || "user_profile,user_media"
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: finalScope,
      response_type: "code",
    })
    if (state) params.append("state", state)
    return `https://api.instagram.com/oauth/authorize?${params.toString()}`
  }

  initiateUserAuth(redirectUri: string, scope: string = "user_profile,user_media") {
    const state = Math.random().toString(36).slice(2)
    const authUrl = this.getAuthUrl(redirectUri, scope, state)
    return { authUrl, state }
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<OAuth2Token> {
    if (!code || !redirectUri) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "InstagramService: missing code or redirect URI"
      )
    }
    if (!this.clientId || !this.clientSecret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "InstagramService: missing INSTAGRAM_CLIENT_ID or INSTAGRAM_CLIENT_SECRET"
      )
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    })

    const resp = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Instagram token exchange failed: ${resp.status} - ${JSON.stringify(err)}`
      )
    }

    // Response shape may include user_id; we normalize to OAuth2Token
    const data = (await resp.json()) as { access_token: string; token_type?: string; expires_in?: number }
    return {
      access_token: data.access_token,
      token_type: (data.token_type as string) || "bearer",
      expires_in: data.expires_in ?? 3600,
      retrieved_at: Date.now(),
    }
  }

  async refreshAccessToken(_refreshToken: string): Promise<OAuth2Token> {
    // Instagram uses long-lived tokens via ig_exchange_token without a refresh_token value
    // Our refresh workflow requires refresh_token, so we fail explicitly here
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "InstagramService: refresh_token is not supported; use long-lived token exchange instead"
    )
  }

  // ----- Graph helpers (via Facebook Graph) -----

  async getLinkedIgAccounts(userAccessToken: string): Promise<Array<{ id: string; username?: string; page_id?: string }>> {
    if (!userAccessToken) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing user access token")
    }
    const url = new URL("https://graph.facebook.com/v18.0/me/accounts")
    url.searchParams.set("fields", "instagram_business_account{id,username}")
    url.searchParams.set("access_token", userAccessToken)
    const resp = await fetch(url.toString())
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Failed to fetch linked IG accounts: ${resp.status} - ${JSON.stringify(err)}`)
    }
    const data = (await resp.json()) as { data?: Array<{ id: string; instagram_business_account?: { id: string; username?: string } }> }
    const igs: Array<{ id: string; username?: string; page_id?: string }> = []
    for (const page of data.data || []) {
      if (page.instagram_business_account?.id) {
        igs.push({ id: page.instagram_business_account.id, username: page.instagram_business_account.username, page_id: page.id })
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
    const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(igUserId)}/media`
    const body = new URLSearchParams()
    if (payload.image_url) body.set("image_url", payload.image_url)
    if (payload.video_url) body.set("video_url", payload.video_url)
    if (payload.caption) body.set("caption", payload.caption)
    if (payload.media_type) body.set("media_type", payload.media_type)
    body.set("access_token", accessToken)
    const resp = await fetch(url, { method: "POST", body })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `IG create container failed: ${resp.status} - ${JSON.stringify(err)}`)
    }
    return (await resp.json()) as { id: string }
  }

  async publishContainer(igUserId: string, creationId: string, accessToken: string): Promise<{ id: string }> {
    const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(igUserId)}/media_publish`
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

  async getMediaPermalink(mediaId: string, accessToken: string): Promise<string | undefined> {
    const url = new URL(`https://graph.facebook.com/v18.0/${encodeURIComponent(mediaId)}`)
    url.searchParams.set("fields", "permalink")
    url.searchParams.set("access_token", accessToken)
    const resp = await fetch(url.toString())
    if (!resp.ok) return undefined
    const data = (await resp.json()) as { permalink?: string }
    return data.permalink
  }
}
