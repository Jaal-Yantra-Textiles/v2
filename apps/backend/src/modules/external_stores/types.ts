/**
 * Common interfaces for external store providers (Etsy, Shopify, Amazon, etc.)
 */

export interface StoreProvider {
  name: string
  
  // OAuth methods
  getAuthorizationUrl(redirectUri: string, scope: string, state: string): Promise<string>
  /**
   * Exchange authorization code for access token.
   * @param code - Authorization code from OAuth callback
   * @param redirectUri - Must match the one used in authorization
   * @param codeVerifier - PKCE code verifier (required for Etsy, optional for others)
   */
  exchangeCodeForToken(code: string, redirectUri: string, codeVerifier?: string): Promise<TokenData>
  refreshAccessToken(refreshToken: string): Promise<TokenData>
  
  // Store info
  getShopInfo(accessToken: string): Promise<ShopInfo>
  
  // PKCE methods (optional, required for Etsy)
  getCodeVerifier?(state: string): string | undefined
  clearCodeVerifier?(state: string): void
}

export interface TokenData {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  scope?: string
  retrieved_at?: number
}

export interface ShopInfo {
  shop_id: string
  shop_name: string
  shop_url?: string
  currency?: string
  country?: string
  [key: string]: any
}

export interface ListingData {
  title: string
  description: string
  price: number
  quantity: number
  images?: string[]
  tags?: string[]
  category_id?: string
  [key: string]: any
}

export interface ListingResponse {
  listing_id: string
  listing_url: string
  status: string
  [key: string]: any
}
