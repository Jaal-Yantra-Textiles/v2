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

export const DEFAULT_API_BASE = "https://faire.com/external-api/v2"
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

export interface ProductVariantInput {
  sku: string
  name?: string
  wholesale_price_cents?: number
  retail_price_cents?: number
  inventory_count?: number
  images?: ProductImage[]
}

export interface CreateProductInput {
  brand_id: string
  name: string
  description?: string
  wholesale_price_cents?: number
  retail_price_cents?: number
  images?: ProductImage[]
  variants?: ProductVariantInput[]
  tags?: string[]
  shipping?: Record<string, any>
  metadata?: Record<string, any>
  short_description?: string
}

export type UpdateProductInput = Partial<CreateProductInput>

export interface ProductResponse {
  product_token: string
  brand_id?: string
  name: string
  description?: string
  state?: ProductState
  url?: string
  wholesale_price_cents?: number
  retail_price_cents?: number
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
 * Payload for `PATCH /product-inventory/by-skus`. Faire ingests an array of
 * per-SKU overrides; each row carries the SKU and the new on-hand count.
 */
export interface InventoryOverrideBySku {
  sku: string
  current_count: number
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
