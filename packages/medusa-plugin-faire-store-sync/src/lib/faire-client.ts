import {
  DEFAULT_API_BASE,
  DEFAULT_AUTH_URL,
  DEFAULT_TOKEN_URL,
  FairePluginOptions,
  FaireAuthMode,
  BrandInfo,
  CreateProductInput,
  UpdateProductInput,
  ProductResponse,
  InventoryOverrideBySku,
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
 * Verified against Faire's OWN Faire-for-WooCommerce plugin
 * (plugins.svn.wordpress.org/faire-for-woocommerce) and 3 production OAuth
 * integrations. Key differences from a presumed OAuth2/REST surface:
 *
 *  ARCHITECTURE — Faire is POLLING, not webhooks. There is NO inbound webhook
 *  registration. Orders/products are pulled via `GET /orders` / `GET /products`
 *  with cursor pagination + `updated_at_min`. Inventory is PUSHED via
 *  `PATCH /product-inventory/by-skus` (not pulled).
 *
 *  AUTH — two modes:
 *   - oauth:  `X-FAIRE-OAUTH-ACCESS-TOKEN: <token>`
 *             `X-FAIRE-APP-CREDENTIALS: base64(applicationId:applicationSecret)`
 *   - apiKey: `X-FAIRE-ACCESS-TOKEN: <token>`
 *  Neither uses `Authorization: Bearer`. Token exchange is non-RFC-6749
 *  (custom field names, JSON body, grant_type="AUTHORIZATION_CODE").
 *
 *  BASE — `https://faire.com/external-api/v2` (bare faire.com, NOT www/api).
 *  BRAND — `GET /brands/profile` (NOT /brand).
 */
export class FaireClient {
  private authMode: FaireAuthMode
  private clientId: string
  private clientSecret: string
  private redirectUri: string
  private apiBase: string
  private authUrl: string
  private tokenUrl: string
  private scope: string
  private apiKey: string

  constructor(opts: FairePluginOptions = {}) {
    this.authMode = opts.authMode ?? "oauth"
    this.clientId = opts.clientId ?? ""
    this.clientSecret = opts.clientSecret ?? ""
    this.redirectUri =
      opts.redirectUri ??
      "http://localhost:9000/app/settings/oauth/faire/callback"
    this.apiBase = opts.apiBase || DEFAULT_API_BASE
    this.authUrl = opts.authUrl || DEFAULT_AUTH_URL
    this.tokenUrl = opts.tokenUrl || DEFAULT_TOKEN_URL
    this.scope = opts.scope ?? ""
    this.apiKey = opts.accessToken ?? ""
  }

  get redirectUriValue(): string {
    return this.redirectUri
  }

  get authModeValue(): FaireAuthMode {
    return this.authMode
  }

  // ── OAuth ───────────────────────────────────────────────────────────────

  /**
   * Normalise the configured scope into a list of individual scope tokens.
   *
   * `FAIRE_SCOPE` may be authored comma- OR space-separated (e.g.
   * "READ_PRODUCTS WRITE_PRODUCTS" or "READ_PRODUCTS,WRITE_PRODUCTS"); split on
   * either so each Faire scope enum is a distinct element. Passing the whole
   * joined string as a single value makes Faire's authorize reject it with
   * `scope.contains(null)` (it comma-splits, sees one unknown enum → null).
   */
  private scopeList(): string[] {
    return this.scope ? this.scope.split(/[\s,]+/).filter(Boolean) : []
  }

  /**
   * Build the Faire OAuth authorize URL.
   *
   * Faire's authorize endpoint takes `applicationId` (NOT client_id),
   * `redirectUrl` (NOT redirect_uri) and a COMMA-joined `scope` (Faire splits
   * the scope param on commas). `state` is round-tripped for CSRF protection.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      applicationId: this.clientId,
      redirectUrl: this.redirectUri,
      state,
    })
    const scopes = this.scopeList()
    if (scopes.length) params.set("scope", scopes.join(","))
    return `${this.authUrl}?${params.toString()}`
  }

  /**
   * Exchange an authorization code for an access token.
   *
   * Faire's token endpoint is NON-RFC-6749: it expects a JSON body with the
   * field names below (NOT client_id/client_secret/redirect_uri), posts to
   * `/api/external-api-oauth2/token`, and returns
   * `{ application_token, access_token, ... }`.
   */
  async exchangeCodeForToken(code: string): Promise<TokenData> {
    const body = {
      application_token: this.clientId,
      application_secret: this.clientSecret,
      authorization_code: code,
      grant_type: "AUTHORIZATION_CODE",
      redirect_url: this.redirectUri,
      scope: this.scopeList(),
    }
    const data = await this.requestJson<any>(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

  /**
   * Revoke an OAuth access token on Faire's side.
   *
   * Faire allows only ONE active OAuth token per (app, brand); without revoking,
   * a reconnect fails with 400 "Application is already installed via an active
   * OAuth access token". Non-RFC-6749 body (matches the token endpoint), posted
   * to `/api/external-api-oauth2/revoke`, no auth header.
   */
  async revokeToken(accessToken: string): Promise<void> {
    if (!accessToken) return
    const revokeUrl = this.tokenUrl.replace(/\/token$/, "/revoke")
    const body = {
      application_token: this.clientId,
      application_secret: this.clientSecret,
      access_token_o_auth: accessToken,
    }
    await this.requestJson<any>(revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      auth: false,
    })
  }

  async refreshAccessToken(refresh_token: string): Promise<TokenData> {
    const body = {
      application_token: this.clientId,
      application_secret: this.clientSecret,
      refresh_token,
      grant_type: "REFRESH_TOKEN",
    }
    const data = await this.requestJson<any>(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
   * brand via `GET /brands/profile`.
   */
  async getBrand(accessToken: string): Promise<BrandInfo> {
    const data = await this.requestJson<any>(
      `${this.apiBase}/brands/profile`,
      { method: "GET", accessToken }
    )
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

  // ── Products (POLL) ─────────────────────────────────────────────────────

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

  /**
   * Poll products. Faire paginates with a cursor (`page` param is a cursor
   * returned by the previous response, NOT a 1-based index) and supports
   * `updated_at_min` for incremental sync. Pass the last cursor + a high-water
   * `updated_at_min` ISO timestamp to fetch only changed products.
   */
  async listProducts(
    accessToken: string,
    opts: { limit?: number; page?: string; updated_at_min?: string } = {}
  ): Promise<{
    count: number
    results: ProductResponse[]
    next_page?: string
  }> {
    const params = new URLSearchParams()
    params.set("limit", String(opts.limit ?? 100))
    if (opts.page != null) params.set("page", String(opts.page))
    if (opts.updated_at_min) params.set("updated_at_min", opts.updated_at_min)
    const data = await this.requestJson<any>(
      `${this.apiBase}/products?${params.toString()}`,
      { method: "GET", accessToken }
    )
    const results = (data.products ?? data.results ?? []).map((p: any) =>
      this.mapProduct(p)
    )
    return {
      count: data.count ?? results.length,
      results,
      next_page: data.next_page ?? data.pagination?.next_page,
    }
  }

  // ── Inventory (PUSH — was inverted) ──────────────────────────────────────

  /**
   * Push inventory overrides to Faire by SKU.
   *
   * Faire does NOT expose a `GET /inventory` you can poll for remote counts —
   * inventory is write-only: `PATCH /product-inventory/by-skus` with an array
   * of `{ sku, current_count }` rows. (A `by-product-variant-ids` variant
   * exists for id-keyed overrides.)
   */
  async updateInventory(
    accessToken: string,
    overrides: InventoryOverrideBySku[]
  ): Promise<any> {
    return this.requestJson<any>(
      `${this.apiBase}/product-inventory/by-skus`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventories: overrides }),
        accessToken,
      }
    )
  }

  // ── Orders (POLL) ───────────────────────────────────────────────────────

  /**
   * Poll orders. Cursor-paginated via `page`; `updated_at_min` enables
   * incremental sync from a persisted last-sync high-water mark.
   */
  async listOrders(
    accessToken: string,
    opts: { limit?: number; page?: string; updated_at_min?: string } = {}
  ): Promise<{
    count: number
    results: FaireOrder[]
    next_page?: string
  }> {
    const params = new URLSearchParams()
    params.set("limit", String(opts.limit ?? 100))
    if (opts.page != null) params.set("page", String(opts.page))
    if (opts.updated_at_min) params.set("updated_at_min", opts.updated_at_min)
    const data = await this.requestJson<any>(
      `${this.apiBase}/orders?${params.toString()}`,
      { method: "GET", accessToken }
    )
    const results = (data.orders ?? data.results ?? []).map((o: any) =>
      this.mapOrder(o)
    )
    return {
      count: data.count ?? results.length,
      results,
      next_page: data.next_page ?? data.pagination?.next_page,
    }
  }

  async getOrder(accessToken: string, orderToken: string): Promise<FaireOrder> {
    const data = await this.requestJson<any>(
      `${this.apiBase}/orders/${orderToken}`,
      { method: "GET", accessToken }
    )
    return this.mapOrder(data?.order ?? data)
  }

  /**
   * Accept/update an order (Faire's "processing" transition).
   * `PUT /orders/{id}/processing`.
   */
  async setOrderProcessing(
    accessToken: string,
    orderToken: string,
    payload: Record<string, any> = {}
  ): Promise<any> {
    return this.requestJson<any>(
      `${this.apiBase}/orders/${orderToken}/processing`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        accessToken,
      }
    )
  }

  /**
   * Post tracking/shipment info to an order.
   * `POST /orders/{id}/shipments`.
   */
  async createOrderShipment(
    accessToken: string,
    orderToken: string,
    shipment: Record<string, any>
  ): Promise<any> {
    return this.requestJson<any>(
      `${this.apiBase}/orders/${orderToken}/shipments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shipment),
        accessToken,
      }
    )
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
    // v2 returns `id` (p_…) + `lifecycle_state` (DRAFT|PUBLISHED). Normalise
    // lifecycle_state → the internal `state` used downstream for publish gating.
    const lifecycle = data.lifecycle_state ?? data.state
    const state =
      lifecycle === "PUBLISHED" || data.state === "active"
        ? "active"
        : lifecycle === "DRAFT" || data.state === "draft"
          ? "draft"
          : data.state
    return {
      product_token: String(data.product_token ?? data.id ?? data.token),
      brand_id: data.brand_id != null ? String(data.brand_id) : undefined,
      name: data.name,
      description: data.description,
      state,
      url: data.url,
      variants: data.variants,
      images: data.images,
      raw: data,
    }
  }

  /**
   * Resolve a Faire taxonomy_type id (`tt_…`) from a category name (or pass a
   * `tt_…` id straight through). Faire create REQUIRES `taxonomy_type.id`;
   * `GET /products/types` returns all ~3k `{ id, name }` rows under the
   * `taxonomy_types` key in a single unpaginated response (verified live
   * 2026-07-09; the `limit` param is ignored). Cached per client.
   */
  private taxonomyTypesCache: Array<{ id: string; name: string }> | null = null
  async resolveTaxonomyTypeId(
    accessToken: string,
    nameOrId: string
  ): Promise<string | null> {
    if (!nameOrId) return null
    if (/^tt_/.test(nameOrId)) return nameOrId
    if (!this.taxonomyTypesCache) {
      const data = await this.requestJson<any>(
        `${this.apiBase}/products/types`,
        { method: "GET", accessToken }
      )
      this.taxonomyTypesCache = (
        data.taxonomy_types ??
        data.product_types ??
        data.types ??
        data.results ??
        []
      ).map((t: any) => ({ id: String(t.id), name: String(t.name ?? "") }))
    }
    const needle = nameOrId.trim().toLowerCase()
    const list = this.taxonomyTypesCache ?? []
    const exact = list.find((t) => t.name.toLowerCase() === needle)
    if (exact) return exact.id
    // Prefer a whole-word match (needle as its own token) over a loose
    // substring — otherwise "Dress" would resolve to "Address Book" (contains
    // "ad-dress"). Fall back to substring only if no word-boundary hit.
    const wordRe = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
    const word = list.find((t) => wordRe.test(t.name.toLowerCase()))
    if (word) return word.id
    const partial = list.find((t) => t.name.toLowerCase().includes(needle))
    return partial?.id ?? null
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

  // ── Auth header assembly ────────────────────────────────────────────────

  /**
   * Build the Faire auth headers for an access token according to the active
   * auth mode. This is the crux of issue #952 §2 — never `Bearer`.
   */
  private authHeaders(accessToken: string): Record<string, string> {
    if (this.authMode === "apiKey") {
      return { "X-FAIRE-ACCESS-TOKEN": accessToken || this.apiKey }
    }
    const headers: Record<string, string> = {
      "X-FAIRE-OAUTH-ACCESS-TOKEN": accessToken,
    }
    if (this.clientId && this.clientSecret) {
      const credentials = Buffer.from(
        `${this.clientId}:${this.clientSecret}`
      ).toString("base64")
      headers["X-FAIRE-APP-CREDENTIALS"] = credentials
    }
    return headers
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
    if (init.auth !== false && init.accessToken) {
      Object.assign(headers, this.authHeaders(init.accessToken))
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
