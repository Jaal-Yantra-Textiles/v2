export interface FairePluginOptions {
  clientId: string
  clientSecret: string
  redirectUri: string
  apiBase?: string
  authUrl?: string
  tokenUrl?: string
  scope?: string
  webhookSecret?: string
}

export const DEFAULT_API_BASE = "https://www.faire.com/api/v2"
export const DEFAULT_AUTH_URL = "https://www.faire.com/oauth/authorize"
export const DEFAULT_TOKEN_URL = "https://www.faire.com/oauth/token"
// Faire OAuth currently exposes no granular scopes; the parameter is kept for
// forward-compat and to match the OAuth2 authorize URL shape.
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
 * Faire returns money as integer cents in the brand's currency. We keep cents
 * end-to-end (never divide by 100) and only convert for display.
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

export interface WebhookRegistration {
  webhook_token?: string
  url: string
  events: string[]
}
