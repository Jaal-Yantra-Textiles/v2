import crypto from "crypto"
import {
  DEFAULT_API_BASE,
  DEFAULT_AUTH_URL,
  DEFAULT_TOKEN_URL,
  FairePluginOptions,
  BrandInfo,
  CreateProductInput,
  UpdateProductInput,
  ProductResponse,
  InventoryLevel,
  FaireOrder,
  TokenData,
} from "./types"

export class FaireApiError extends Error {
  status: number
  body: any
  constructor(message: string, status: number, body: any) {
    super(message)
    this.name = "FaireApiError"
    this.status = status
    this.body = body
  }
}

/**
 * Faire External Platform API v2 client.
 *
 * Auth model:
 *  - OAuth 2.0 authorization-code flow (no PKCE; Faire does not use PKCE).
 *  - Scoped requests send `Authorization: Bearer <access_token>`.
 *  - Faire's API-key mode (`X-FAIRE-ACCESS-TOKEN`) is not used here because the
 *    plugin connects a brand account via OAuth redirect.
 *
 * NOTE: Faire's developer portal is access-gated. Endpoint paths, payload
 * shapes and the webhook signature scheme below reflect the publicly documented
 * v2 surface and standard OAuth2 conventions; adjust via options / env if your
 * Faire app uses a different base or signing scheme.
 */
export class FaireClient {
  private clientId: string
  private clientSecret: string
  private redirectUri: string
  private apiBase: string
  private authUrl: string
  private tokenUrl: string
  private scope: string

  constructor(opts: FairePluginOptions) {
    this.clientId = opts.clientId
    this.clientSecret = opts.clientSecret
    this.redirectUri = opts.redirectUri
    this.apiBase = opts.apiBase || DEFAULT_API_BASE
    this.authUrl = opts.authUrl || DEFAULT_AUTH_URL
    this.tokenUrl = opts.tokenUrl || DEFAULT_TOKEN_URL
    this.scope = opts.scope ?? ""
  }

  get redirectUriValue(): string {
    return this.redirectUri
  }

  // ── OAuth ───────────────────────────────────────────────────────────────

  /**
   * Build the Faire OAuth authorize URL. The caller must persist `state`
   * (keyed by it) for the callback verification.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state,
    })
    if (this.scope) params.set("scope", this.scope)
    return `${this.authUrl}?${params.toString()}`
  }

  async exchangeCodeForToken(code: string): Promise<TokenData> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      code,
    })
    const data = await this.requestJson<any>(this.tokenUrl, {
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
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token,
    })
    const data = await this.requestJson<any>(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      auth: false,
    })
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refresh_token,
      token_type: data.token_type || "Bearer",
      expires_in: data.expires_in,
      retrieved_at: Date.now(),
    }
  }

  /**
   * Resolve the brand the access token belongs to. Faire exposes the current
   * brand via GET /api/v2/brand. Falls back gracefully if the shape differs.
   */
  async getBrand(accessToken: string): Promise<BrandInfo> {
    const data = await this.requestJson<any>(`${this.apiBase}/brand`, {
      method: "GET",
      accessToken,
    })
    const brand =
      data && typeof data === "object" && (data.brand_id || data.id)
        ? data
        : data?.brand ?? data?.results?.[0] ?? data
    if (!brand?.brand_id && !brand?.id) {
      throw new Error(
        "No Faire brand found for the authorized account. Make sure you connected the brand owner."
      )
    }
    return {
      brand_id: String(brand.brand_id ?? brand.id),
      brand_name: brand.name ?? brand.brand_name ?? "Faire Brand",
      currency: brand.currency ?? brand.currency_code,
      country: brand.country ?? brand.country_code,
      raw: brand,
    }
  }

  async fetchResource<T = any>(accessToken: string, url: string): Promise<T> {
    return this.requestJson<T>(url, { method: "GET", accessToken })
  }

  // ── Products ────────────────────────────────────────────────────────────

  async createProduct(
    accessToken: string,
    input: CreateProductInput
  ): Promise<ProductResponse> {
    const data = await this.requestJson<any>(`${this.apiBase}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      accessToken,
    })
    return this.mapProduct(data?.product ?? data)
  }

  async updateProduct(
    accessToken: string,
    productToken: string,
    input: UpdateProductInput
  ): Promise<ProductResponse> {
    const data = await this.requestJson<any>(
      `${this.apiBase}/products/${productToken}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        accessToken,
      }
    )
    return this.mapProduct(data?.product ?? data)
  }

  async getProduct(
    accessToken: string,
    productToken: string
  ): Promise<ProductResponse> {
    const data = await this.requestJson<any>(
      `${this.apiBase}/products/${productToken}`,
      { method: "GET", accessToken }
    )
    return this.mapProduct(data?.product ?? data)
  }

  async listProducts(
    accessToken: string,
    opts: { limit?: number; page?: number } = {}
  ): Promise<{ count: number; results: ProductResponse[] }> {
    const params = new URLSearchParams()
    params.set("limit", String(opts.limit ?? 100))
    if (opts.page != null) params.set("page", String(opts.page))
    const data = await this.requestJson<any>(
      `${this.apiBase}/products?${params.toString()}`,
      { method: "GET", accessToken }
    )
    const results = (data.products ?? data.results ?? []).map((p: any) =>
      this.mapProduct(p)
    )
    return { count: data.count ?? results.length, results }
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async getInventory(
    accessToken: string,
    productToken?: string
  ): Promise<InventoryLevel[]> {
    const params = new URLSearchParams()
    if (productToken) params.set("product_token", productToken)
    const data = await this.requestJson<any>(
      `${this.apiBase}/inventory?${params.toString()}`,
      { method: "GET", accessToken }
    )
    const rows = data.inventory ?? data.results ?? []
    return (Array.isArray(rows) ? rows : []).map((r: any) => ({
      sku: String(r.sku ?? r.variant_id ?? ""),
      product_token: r.product_token ? String(r.product_token) : undefined,
      current_count: Number(r.current_count ?? r.inventory_count ?? 0),
      raw: r,
    }))
  }

  async updateInventory(
    accessToken: string,
    levels: Array<{ sku: string; current_count: number }>
  ): Promise<any> {
    return this.requestJson<any>(`${this.apiBase}/inventory`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventory: levels }),
      accessToken,
    })
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async listOrders(
    accessToken: string,
    opts: { limit?: number; page?: number } = {}
  ): Promise<{ count: number; results: FaireOrder[] }> {
    const params = new URLSearchParams()
    params.set("limit", String(opts.limit ?? 100))
    if (opts.page != null) params.set("page", String(opts.page))
    const data = await this.requestJson<any>(
      `${this.apiBase}/orders?${params.toString()}`,
      { method: "GET", accessToken }
    )
    const results = (data.orders ?? data.results ?? []).map((o: any) =>
      this.mapOrder(o)
    )
    return { count: data.count ?? results.length, results }
  }

  async getOrder(accessToken: string, orderToken: string): Promise<FaireOrder> {
    const data = await this.requestJson<any>(
      `${this.apiBase}/orders/${orderToken}`,
      { method: "GET", accessToken }
    )
    return this.mapOrder(data?.order ?? data)
  }

  async setOrderItemAvailability(
    accessToken: string,
    orderToken: string,
    items: Array<{ item_id: string; availability: string }>
  ): Promise<any> {
    return this.requestJson<any>(
      `${this.apiBase}/orders/${orderToken}/items/availability`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        accessToken,
      }
    )
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  async registerWebhook(
    accessToken: string,
    payload: { url: string; events: string[] }
  ): Promise<any> {
    return this.requestJson<any>(`${this.apiBase}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      accessToken,
    })
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Fetch a remote image URL into a Buffer (used when Faire requires binary
   * image payloads rather than remote URLs).
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

  private mapProduct(data: any): ProductResponse {
    return {
      product_token: String(data.product_token ?? data.id ?? data.token),
      brand_id: data.brand_id != null ? String(data.brand_id) : undefined,
      name: data.name,
      description: data.description,
      state: data.state,
      url: data.url,
      wholesale_price_cents: data.wholesale_price_cents,
      retail_price_cents: data.retail_price_cents,
      variants: data.variants,
      images: data.images,
      raw: data,
    }
  }

  private mapOrder(data: any): FaireOrder {
    return {
      order_token: String(data.order_token ?? data.id ?? data.token),
      state: data.state ?? data.status,
      currency: data.currency ?? data.currency_code,
      total_cents: data.total_cents ?? data.grand_total_cents,
      buyer_name: data.buyer_name ?? data.customer?.name,
      raw: data,
    }
  }

  // ── Low-level request with rate-limit handling ──────────────────────────

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
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init.headers || {}),
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

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") || 1)
        await this.sleep(Math.min(retryAfter * 1000, 10000))
        continue
      }

      if (res.status === 401) {
        throw new FaireApiError("Faire access token expired or invalid", 401, null)
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
        const detail =
          body?.error_description ||
          body?.error ||
          body?.message ||
          (Array.isArray(body?.errors)
            ? body.errors.map((e: any) => e?.message || e?.error || e).join("; ")
            : undefined) ||
          (typeof body === "string" && body ? body : undefined) ||
          (body && typeof body === "object" ? JSON.stringify(body) : undefined)
        const msg = detail
          ? `Faire API ${res.status}: ${detail}`
          : `Faire API error ${res.status}`
        throw new FaireApiError(msg, res.status, body)
      }

      return body as T
    }
    throw new FaireApiError("Max retries exceeded", 599, null)
  }

  private async backoff(attempt: number): Promise<void> {
    await this.sleep(Math.min(500 * Math.pow(2, attempt - 1), 8000))
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
