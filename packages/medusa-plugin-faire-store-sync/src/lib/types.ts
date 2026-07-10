/**
 * Faire exposes TWO auth models (verified against Faire's own
 * Faire-for-WooCommerce plugin + 3 production OAuth integrations):
 *
 *  - "oauth"   — multi-merchant OAuth app. Requests send
 *                `X-FAIRE-OAUTH-ACCESS-TOKEN` AND `X-FAIRE-APP-CREDENTIALS`
 *                (base64(applicationId:applicationSecret)). Token exchange is
 *                NON-RFC-6749 (see exchangeCodeForToken).
 *  - "apiKey"  — single-merchant API key. Requests send
 *                `X-FAIRE-ACCESS-TOKEN`. No OAuth dance at all.
 *
 * The plugin supports both; pick via FAIRE_AUTH_MODE / options.authMode.
 */
export type FaireAuthMode = "oauth" | "apiKey"

export interface FairePluginOptions {
  authMode?: FaireAuthMode
  // OAuth app credentials (required when authMode === "oauth")
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  scope?: string
  // API-key mode (required when authMode === "apiKey")
  accessToken?: string
  // Shared
  apiBase?: string
  authUrl?: string
  tokenUrl?: string
}

// MUST be the canonical www host. Bare `faire.com` 301-redirects to www, and a
// 301 on a POST/PUT strips the request body (fetch/curl replay it without the
// payload) — so writes (createProduct/updateProduct) silently no-op'd, coming
// back as if they were `GET /products` (a product LIST). Verified live 2026-07-09.
export const DEFAULT_API_BASE = "https://www.faire.com/external-api/v2"
export const DEFAULT_AUTH_URL = "https://faire.com/oauth2/authorize"
export const DEFAULT_TOKEN_URL = "https://www.faire.com/api/external-api-oauth2/token"
// Faire OAuth scopes are coarse tokens like READ_ORDERS, WRITE_PRODUCTS. The
// authorize URL expects a space-joined `scope` param; left empty the app's
// default scopes apply.
export const DEFAULT_SCOPE = ""

export interface TokenData {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  retrieved_at: number
}

export interface BrandInfo {
  brand_id: string
  brand_name: string
  currency?: string
  country?: string
  raw: Record<string, any>
}

/**
 * Faire returns money as integer cents in the brand's currency. Keep cents for
 * transport/storage, but convert to decimal major units (cents / 100) at the
 * boundary where amounts enter Medusa order/payment workflows — see
 * faireMoney() in ingest-faire-order-support.ts.
 */
export interface FaireMoney {
  amount_cents: number
  currency_code?: string
}

export type ProductState = "active" | "inactive" | "sold_out" | "draft"

export interface ProductImage {
  url: string
}

/**
 * Faire External API v2 create/update product contract (verified live
 * 2026-07-09 against `POST https://www.faire.com/external-api/v2/products`).
 *
 * Money is `amount_minor` (integer minor units = cents) + `currency`. Each
 * variant price is scoped to a geo (`country` ISO-2 OR a `country_group` enum
 * like EUROPEAN_UNION). `taxonomy_type.id` (a `tt_…` id from GET /products/types)
 * and per-entity `idempotence_token`s are REQUIRED — omitting either 400s.
 */
export type FaireLifecycleState = "DRAFT" | "PUBLISHED"

export interface FaireGeoConstraint {
  country?: string
  country_group?: string
}

export interface FaireMoneyMinor {
  amount_minor: number
  currency: string
}

export interface FaireVariantPrice {
  geo_constraint: FaireGeoConstraint
  wholesale_price: FaireMoneyMinor
  retail_price: FaireMoneyMinor
}

export interface FaireVariantOption {
  name: string
  value: string
}

export interface ProductVariantInput {
  sku: string
  name: string
  idempotence_token: string
  options?: FaireVariantOption[]
  available_quantity?: number
  prices?: FaireVariantPrice[]
  images?: ProductImage[]
}

export interface CreateProductInput {
  name: string
  idempotence_token: string
  lifecycle_state: FaireLifecycleState
  taxonomy_type: { id: string }
  description?: string
  short_description?: string
  variants: ProductVariantInput[]
  images?: ProductImage[]
  unit_multiplier?: number
  minimum_order_quantity?: number
}

export type UpdateProductInput = Partial<CreateProductInput>

export interface ProductResponse {
  product_token: string
  brand_id?: string
  name: string
  description?: string
  state?: ProductState
  url?: string
  variants?: any[]
  images?: ProductImage[]
  raw: Record<string, any>
}

export interface InventoryLevel {
  sku: string
  product_token?: string
  current_count: number
  raw?: Record<string, any>
}

/**
 * Payload row for `PATCH /product-inventory/by-skus`. Faire ingests an array
 * under `inventories`; each row carries the SKU and the new on-hand count.
 * The writable quantity field is `on_hand_quantity` (integer) — verified live
 * 2026-07-09 against the docs (there is NO `current_count`/`available_quantity`
 * on this endpoint; those belong to other inventory endpoints). `product_variant_id`
 * is optional — Faire resolves the row by SKU when it's omitted.
 */
export interface InventoryOverrideBySku {
  sku: string
  on_hand_quantity: number
  product_variant_id?: string
}

export interface FaireOrder {
  order_token: string
  state?: string
  currency?: string
  total_cents?: number
  buyer_name?: string
  raw: Record<string, any>
}

export interface PreparedProduct {
  product: ProductResponse
  published: boolean
  warnings: string[]
}
