import crypto from "crypto"
import {
  DEFAULT_SCOPES,
  CreateListingInput,
  ListingResponse,
  PkcePair,
  PreparedListing,
  ReadinessState,
  ReturnPolicy,
  ShippingProfile,
  ShopInfo,
  TaxonomyNode,
  TokenData,
  UpdateListingInput,
  UploadedImage,
} from "./types"

const API_BASE = "https://api.etsy.com/v3"
const AUTH_URL = "https://www.etsy.com/oauth/connect"
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token"

export class EtsyApiError extends Error {
  status: number
  body: any
  constructor(message: string, status: number, body: any) {
    super(message)
    this.name = "EtsyApiError"
    this.status = status
    this.body = body
  }
}

/**
 * Etsy Open API v3 client.
 *
 * Auth model (verified against the Etsy OpenAPI spec):
 *  - Every request sends `x-api-key: <keystring>:<shared_secret>`.
 *  - Scoped requests also send `Authorization: Bearer <userId>.<token>`.
 *  - OAuth2 Authorization Code + PKCE. Access token 1h, refresh token 90d (rotates).
 *
 * Listing publish flow (mandatory):
 *  - createDraftListing ALWAYS creates a `draft` (HTTP 201).
 *  - A listing cannot be set to `active` until it has >=1 image.
 *  - To publish: upload image(s) -> PATCH state=active. Physical listings also
 *    need shipping_profile_id, return_policy_id and readiness_state_id.
 */
export class EtsyClient {
  private keystring: string
  private sharedSecret: string
  private redirectUri: string
  private scope: string

  constructor(opts: {
    keystring: string
    sharedSecret: string
    redirectUri: string
    scope?: string
  }) {
    this.keystring = opts.keystring
    this.sharedSecret = opts.sharedSecret
    this.redirectUri = opts.redirectUri
    this.scope = opts.scope || DEFAULT_SCOPES
  }

  get apiKeyHeader(): string {
    return `${this.keystring}:${this.sharedSecret}`
  }

  get redirectUriValue(): string {
    return this.redirectUri
  }

  get scopeValue(): string {
    return this.scope
  }

  // ── PKCE ────────────────────────────────────────────────────────────────

  static generatePkce(): PkcePair {
    const code_verifier = crypto
      .randomBytes(32)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
    const code_challenge = crypto
      .createHash("sha256")
      .update(code_verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
    return { code_verifier, code_challenge }
  }

  /**
   * Build the Etsy OAuth authorize URL. The caller must persist the
   * `code_verifier` (keyed by `state`) for the token exchange.
   */
  getAuthorizationUrl(state: string, code_challenge: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.keystring,
      redirect_uri: this.redirectUri,
      scope: this.scope,
      state,
      code_challenge,
      code_challenge_method: "S256",
    })
    return `${AUTH_URL}?${params.toString()}`
  }

  // ── OAuth token endpoints ───────────────────────────────────────────────

  async exchangeCodeForToken(code: string, code_verifier: string): Promise<TokenData> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.keystring,
      redirect_uri: this.redirectUri,
      code,
      code_verifier,
    })
    const data = await this.requestJson<any>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      auth: false,
    })
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || "Bearer",
      expires_in: data.expires_in,
      retrieved_at: Date.now(),
    }
  }

  async refreshAccessToken(refresh_token: string): Promise<TokenData> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.keystring,
      refresh_token,
    })
    const data = await this.requestJson<any>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      auth: false,
    })
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || "Bearer",
      expires_in: data.expires_in,
      retrieved_at: Date.now(),
    }
  }

  // ── Shop ────────────────────────────────────────────────────────────────

  /**
   * Resolve the seller's shop from the access token. The numeric prefix before
   * the `.` in the token is the internal user_id.
   */
  async getShopByAccessToken(accessToken: string): Promise<ShopInfo> {
    const parts = accessToken.split(".")
    const userId = parts[0]
    if (parts.length < 2 || !/^\d+$/.test(userId)) {
      throw new Error("Invalid Etsy access token: missing user_id prefix")
    }
    return this.getShopByOwnerUserId(accessToken, userId)
  }

  async getShopByOwnerUserId(accessToken: string, userId: string): Promise<ShopInfo> {
    const data = await this.requestJson<any>(
      `${API_BASE}/application/users/${userId}/shops`,
      { method: "GET", accessToken }
    )
    // Etsy's getShopByOwnerUserId returns the Shop object directly. Be tolerant
    // of wrapped ({ results: [shop] }) and array shapes too. If no shop_id can
    // be found, surface the response shape so the failure is diagnosable.
    const shop =
      data && typeof data === "object" && data.shop_id
        ? data
        : Array.isArray(data)
          ? data[0]
          : data?.results?.[0] ?? data?.shops?.[0]
    if (!shop?.shop_id) {
      const shape =
        data && typeof data === "object"
          ? Object.keys(data).join(", ") || "empty object"
          : String(typeof data)
      throw new Error(
        `No Etsy shop found for the authorized account (response: ${shape}). ` +
          `Make sure you authorized with the Etsy account that owns your shop.`
      )
    }
    return {
      shop_id: String(shop.shop_id),
      shop_name: shop.shop_name,
      shop_url: shop.url,
      currency: shop.currency_code,
      country: shop.country_iso,
      raw: shop,
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.requestJson<any>(`${API_BASE}/application/openapi-ping`, {
        method: "GET",
        auth: false,
      })
      return true
    } catch {
      return false
    }
  }

  // ── Listings ────────────────────────────────────────────────────────────

  async createDraftListing(
    accessToken: string,
    shopId: string,
    input: CreateListingInput
  ): Promise<ListingResponse> {
    const form = this.buildListingForm(input)
    const data = await this.requestJson<any>(
      `${API_BASE}/application/shops/${shopId}/listings?legacy=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        accessToken,
      }
    )
    return this.mapListing(data)
  }

  async updateListing(
    accessToken: string,
    shopId: string,
    listingId: string,
    input: UpdateListingInput
  ): Promise<ListingResponse> {
    const form = this.buildListingForm(input)
    const data = await this.requestJson<any>(
      `${API_BASE}/application/shops/${shopId}/listings/${listingId}?legacy=true`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        accessToken,
      }
    )
    return this.mapListing(data)
  }

  async getListing(accessToken: string, listingId: string): Promise<ListingResponse> {
    const data = await this.requestJson<any>(
      `${API_BASE}/application/listings/${listingId}`,
      { method: "GET", accessToken }
    )
    return this.mapListing(data)
  }

  async getListingsByShop(
    accessToken: string,
    shopId: string,
    opts: {
      state?: "active" | "inactive" | "sold_out" | "draft" | "expired"
      limit?: number
      offset?: number
      includes?: string[]
    } = {}
  ): Promise<{ count: number; results: ListingResponse[] }> {
    const params = new URLSearchParams()
    params.set("limit", String(opts.limit ?? 100))
    params.set("offset", String(opts.offset ?? 0))
    if (opts.state) params.set("state", opts.state)
    if (opts.includes?.length) params.set("includes", opts.includes.join(","))
    const data = await this.requestJson<any>(
      `${API_BASE}/application/shops/${shopId}/listings?${params.toString()}`,
      { method: "GET", accessToken }
    )
    return {
      count: data.count ?? 0,
      results: (data.results ?? []).map((l: any) => this.mapListing(l)),
    }
  }

  async deleteListing(accessToken: string, listingId: string): Promise<void> {
    await this.requestJson<any>(`${API_BASE}/application/listings/${listingId}`, {
      method: "DELETE",
      accessToken,
    })
  }

  // ── Listing images (multipart binary upload) ───────────────────────────

  async uploadListingImage(
    accessToken: string,
    shopId: string,
    listingId: string,
    imageBuffer: Buffer,
    filename: string,
    opts: { rank?: number; overwrite?: boolean; alt_text?: string } = {}
  ): Promise<UploadedImage> {
    const form = new FormData()
    const blob = new Blob([new Uint8Array(imageBuffer)])
    form.append("image", blob, filename)
    if (opts.rank !== undefined) form.append("rank", String(opts.rank))
    if (opts.overwrite !== undefined) form.append("overwrite", String(opts.overwrite))
    if (opts.alt_text) form.append("alt_text", opts.alt_text)

    const data = await this.requestJson<any>(
      `${API_BASE}/application/shops/${shopId}/listings/${listingId}/images`,
      {
        method: "POST",
        body: form,
        accessToken,
      }
    )
    return {
      listing_image_id: String(data.listing_image_id),
      rank: data.rank,
      url_fullxfull: data.url_fullxfull,
      raw: data,
    }
  }

  // ── Inventory (JSON) ───────────────────────────────────────────────────

  async getListingInventory(accessToken: string, listingId: string): Promise<any> {
    return this.requestJson<any>(
      `${API_BASE}/application/listings/${listingId}/inventory`,
      { method: "GET", accessToken }
    )
  }

  async updateListingInventory(
    accessToken: string,
    listingId: string,
    inventory: any
  ): Promise<any> {
    return this.requestJson<any>(
      `${API_BASE}/application/listings/${listingId}/inventory`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inventory),
        accessToken,
      }
    )
  }

  // ── Shop config (shipping, return policies, processing profiles) ───────

  async getShopShippingProfiles(
    accessToken: string,
    shopId: string
  ): Promise<ShippingProfile[]> {
    const data = await this.requestJson<any>(
      `${API_BASE}/application/shops/${shopId}/shipping-profiles`,
      { method: "GET", accessToken }
    )
    return (data.results ?? []).map((p: any) => ({
      shipping_profile_id: String(p.shipping_profile_id),
      title: p.title,
      raw: p,
    }))
  }

  async getShopReturnPolicies(
    accessToken: string,
    shopId: string
  ): Promise<ReturnPolicy[]> {
    const data = await this.requestJson<any>(
      `${API_BASE}/application/shops/${shopId}/policies/return`,
      { method: "GET", accessToken }
    )
    return (data.results ?? []).map((p: any) => ({
      return_policy_id: String(p.return_policy_id),
      name: p.name,
      raw: p,
    }))
  }

  async getShopReadinessStates(
    accessToken: string,
    shopId: string
  ): Promise<ReadinessState[]> {
    const data = await this.requestJson<any>(
      `${API_BASE}/application/shops/${shopId}/readiness-state-definitions`,
      { method: "GET", accessToken }
    )
    return (data.results ?? []).map((r: any) => ({
      id: String(r.readiness_state_id ?? r.id),
      label: r.label ?? r.name ?? String(r.readiness_state_id ?? r.id),
      raw: r,
    }))
  }

  // ── Taxonomy (api_key only, no oauth) ──────────────────────────────────

  async getSellerTaxonomyNodes(): Promise<TaxonomyNode[]> {
    const data = await this.requestJson<any>(
      `${API_BASE}/application/seller-taxonomy/nodes`,
      { method: "GET" }
    )
    return data.results ?? []
  }

  // ── High-level helpers ─────────────────────────────────────────────────

  /**
   * Fetch a remote image URL into a Buffer for multipart upload.
   */
  static async fetchImageBuffer(url: string): Promise<{ buffer: Buffer; filename: string }> {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to fetch image ${url}: ${res.status}`)
    }
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const filename = url.split("/").pop()?.split("?")[0] || "image.jpg"
    return { buffer, filename }
  }

  private mapListing(data: any): ListingResponse {
    return {
      listing_id: String(data.listing_id),
      shop_id: data.shop_id != null ? String(data.shop_id) : undefined,
      state: data.state,
      title: data.title,
      url: data.url,
      quantity: data.quantity,
      price: data.price?.amount != null
        ? data.price.amount / (data.price.divisor || 100)
        : undefined,
      raw: data,
    }
  }

  /**
   * Build a form-urlencoded body. Array fields (image_ids, tags, materials,
   * production_partner_ids) are appended as repeated keys per Etsy's spec.
   */
  private buildListingForm(input: any): URLSearchParams {
    const form = new URLSearchParams()
    const set = (key: string, value: any) => {
      if (value === undefined || value === null) return
      form.set(key, String(value))
    }
    const setArray = (key: string, value: any) => {
      if (!Array.isArray(value) || value.length === 0) return
      form.delete(key)
      value.forEach((v) => form.append(key, String(v)))
    }

    set("quantity", input.quantity)
    set("title", input.title)
    set("description", input.description)
    set("price", input.price)
    set("who_made", input.who_made)
    set("when_made", input.when_made)
    set("taxonomy_id", input.taxonomy_id)
    set("shipping_profile_id", input.shipping_profile_id)
    set("return_policy_id", input.return_policy_id)
    set("readiness_state_id", input.readiness_state_id)
    set("shop_section_id", input.shop_section_id)
    set("is_supply", input.is_supply)
    set("type", input.type)
    set("should_auto_renew", input.should_auto_renew)
    set("is_taxable", input.is_taxable)
    set("item_weight", input.item_weight)
    set("item_length", input.item_length)
    set("item_width", input.item_width)
    set("item_height", input.item_height)
    set("item_weight_unit", input.item_weight_unit)
    set("item_dimensions_unit", input.item_dimensions_unit)
    set("state", input.state)
    setArray("image_ids", input.image_ids)
    setArray("materials", input.materials)
    setArray("tags", input.tags)
    setArray("production_partner_ids", input.production_partner_ids)
    return form
  }

  // ── Low-level request with rate-limit handling ─────────────────────────

  private async requestJson<T>(
    url: string,
    init: {
      method: string
      body?: any
      headers?: Record<string, string>
      accessToken?: string
      auth?: boolean
    }
  ): Promise<T> {
    const requiresKey = init.auth !== false
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init.headers || {}),
    }
    if (requiresKey) {
      headers["x-api-key"] = this.apiKeyHeader
    }
    if (init.accessToken) {
      headers["Authorization"] = `Bearer ${init.accessToken}`
    }

    let attempt = 0
    const maxAttempts = 4
    while (attempt < maxAttempts) {
      attempt++
      let res: Response
      try {
        res = await fetch(url, { method: init.method, headers, body: init.body })
      } catch (err: any) {
        if (attempt >= maxAttempts) throw err
        await this.backoff(attempt)
        continue
      }

      // Rate limited
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") || 1)
        await this.sleep(Math.min(retryAfter * 1000, 10000))
        continue
      }

      // Token expired mid-request -> signal caller to refresh
      if (res.status === 401) {
        throw new EtsyApiError("Etsy access token expired or invalid", 401, null)
      }

      if (res.status === 204) {
        return undefined as T
      }

      const text = await res.text()
      let body: any = null
      if (text) {
        try {
          body = JSON.parse(text)
        } catch {
          body = text
        }
      }

      if (!res.ok) {
        const msg =
          body?.error || body?.message || `Etsy API error ${res.status}`
        throw new EtsyApiError(msg, res.status, body)
      }

      return body as T
    }
    throw new EtsyApiError("Max retries exceeded", 599, null)
  }

  private async backoff(attempt: number): Promise<void> {
    await this.sleep(Math.min(500 * Math.pow(2, attempt - 1), 8000))
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export type PreparedListingResult = PreparedListing
