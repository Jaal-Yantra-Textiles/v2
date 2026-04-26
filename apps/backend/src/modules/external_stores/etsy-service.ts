import axios from "axios"
import crypto from "crypto"
import { StoreProvider, TokenData, ShopInfo, ListingData, ListingResponse } from "./types"

/**
 * Etsy API v3 service implementation.
 * 
 * Docs: https://developers.etsy.com/documentation/
 * 
 * IMPORTANT: Etsy OAuth requires PKCE (Proof Key for Code Exchange)
 * - code_verifier: Random string (43-128 chars)
 * - code_challenge: SHA256 hash of code_verifier, base64url encoded
 * - code_challenge_method: "S256"
 * 
 * Required environment variables:
 * - ETSY_CLIENT_ID (keystring from Etsy app)
 * - ETSY_REDIRECT_URI
 * - ETSY_SCOPE (optional, defaults to listings_r listings_w shops_r)
 * 
 * Note: ETSY_CLIENT_SECRET is NOT required - Etsy uses PKCE instead
 */
export default class EtsyService implements StoreProvider {
  name = "etsy"
  
  private clientId: string
  private baseUrl = "https://openapi.etsy.com/v3"
  private authUrl = "https://www.etsy.com/oauth/connect"
  private tokenUrl = "https://api.etsy.com/v3/public/oauth/token"
  
  // Store code verifiers by state for PKCE flow
  private codeVerifiers: Map<string, string> = new Map()

  constructor() {
    this.clientId = process.env.ETSY_CLIENT_ID || ""

    if (!this.clientId) {
      console.warn("[EtsyService] Missing ETSY_CLIENT_ID environment variable (keystring from Etsy app)")
    }
  }

  /**
   * Generate a cryptographically random code verifier for PKCE.
   * Must be 43-128 characters, using unreserved URI characters.
   */
  private generateCodeVerifier(): string {
    // Generate 32 random bytes and convert to base64url (43 chars)
    const buffer = crypto.randomBytes(32)
    return buffer
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
  }

  /**
   * Generate code challenge from code verifier using SHA256.
   * This is the S256 method required by Etsy.
   */
  private generateCodeChallenge(codeVerifier: string): string {
    const hash = crypto.createHash("sha256").update(codeVerifier).digest()
    return hash
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
  }

  /**
   * Get the code verifier for a given state.
   * Used during token exchange.
   */
  getCodeVerifier(state: string): string | undefined {
    return this.codeVerifiers.get(state)
  }

  /**
   * Clear the code verifier for a given state.
   * Should be called after successful token exchange.
   */
  clearCodeVerifier(state: string): void {
    this.codeVerifiers.delete(state)
  }

  /**
   * Generate Etsy OAuth authorization URL with PKCE.
   * 
   * @param redirectUri - Callback URL registered in Etsy app
   * @param scope - Space-separated scopes (e.g., "listings_r listings_w shops_r")
   * @param state - CSRF protection state parameter
   * @returns Authorization URL and code verifier (needed for token exchange)
   */
  async getAuthorizationUrl(redirectUri: string, scope: string, state: string): Promise<string> {
    const defaultScope = "listings_r listings_w shops_r"
    const finalScope = scope || defaultScope

    // Generate PKCE code verifier and challenge
    const codeVerifier = this.generateCodeVerifier()
    const codeChallenge = this.generateCodeChallenge(codeVerifier)
    
    // Store code verifier for later use in token exchange
    this.codeVerifiers.set(state, codeVerifier)
    
    console.log(`[EtsyService] Generated PKCE for state ${state}:`)
    console.log(`[EtsyService] Code Verifier: ${codeVerifier.substring(0, 10)}...`)
    console.log(`[EtsyService] Code Challenge: ${codeChallenge}`)

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: finalScope,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    })

    const authUrl = `${this.authUrl}?${params.toString()}`
    console.log(`[EtsyService] Authorization URL: ${authUrl}`)
    
    return authUrl
  }

  /**
   * Exchange authorization code for access token.
   * PKCE: Must include the code_verifier that corresponds to the code_challenge.
   * 
   * @param code - Authorization code from OAuth callback
   * @param redirectUri - Must match the one used in authorization
   * @param codeVerifier - PKCE code verifier (required for Etsy)
   */
  async exchangeCodeForToken(code: string, redirectUri: string, codeVerifier?: string): Promise<TokenData> {
    if (!codeVerifier) {
      throw new Error("code_verifier is required for Etsy OAuth (PKCE)")
    }
    
    console.log(`[EtsyService] Exchanging code for token...`)
    console.log(`[EtsyService] Code: ${code.substring(0, 10)}...`)
    console.log(`[EtsyService] Redirect URI: ${redirectUri}`)
    console.log(`[EtsyService] Code Verifier: ${codeVerifier.substring(0, 10)}...`)
    
    try {
      const response = await axios.post(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: this.clientId,
          code: code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      )

      console.log(`[EtsyService] Token exchange successful!`)
      
      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        token_type: response.data.token_type || "Bearer",
        expires_in: response.data.expires_in,
        retrieved_at: Date.now(),
      }
    } catch (error: any) {
      console.error("[EtsyService] Token exchange failed:", error.response?.data || error.message)
      throw new Error(`Failed to exchange code for token: ${error.response?.data?.error || error.message}`)
    }
  }

  /**
   * Refresh an expired access token.
   * 
   * @param refreshToken - Refresh token from previous OAuth flow
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenData> {
    try {
      const response = await axios.post(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: this.clientId,
          refresh_token: refreshToken,
        }).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      )

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        token_type: response.data.token_type || "Bearer",
        expires_in: response.data.expires_in,
        retrieved_at: Date.now(),
      }
    } catch (error: any) {
      console.error("[EtsyService] Token refresh failed:", error.response?.data || error.message)
      throw new Error(`Failed to refresh token: ${error.response?.data?.error || error.message}`)
    }
  }

  /**
   * Get shop information for the authenticated user.
   * 
   * @param accessToken - OAuth access token
   */
  async getShopInfo(accessToken: string): Promise<ShopInfo> {
    try {
      // First, get user's shop IDs
      const userResponse = await axios.get(`${this.baseUrl}/application/users/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-api-key": this.clientId,
        },
      })

      const userId = userResponse.data.user_id
      
      // Get shops for this user
      const shopsResponse = await axios.get(`${this.baseUrl}/application/users/${userId}/shops`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-api-key": this.clientId,
        },
      })

      if (!shopsResponse.data.results || shopsResponse.data.results.length === 0) {
        throw new Error("No shops found for this user")
      }

      const shop = shopsResponse.data.results[0]

      return {
        shop_id: shop.shop_id.toString(),
        shop_name: shop.shop_name,
        shop_url: shop.url,
        currency: shop.currency_code,
        country: shop.country_iso,
        raw: shop,
      }
    } catch (error: any) {
      console.error("[EtsyService] Failed to get shop info:", error.response?.data || error.message)
      throw new Error(`Failed to get shop info: ${error.response?.data?.error || error.message}`)
    }
  }

  /**
   * Create a new listing on Etsy.
   * 
   * @param accessToken - OAuth access token
   * @param shopId - Etsy shop ID
   * @param listingData - Listing details
   */
  async createListing(
    accessToken: string,
    shopId: string,
    listingData: ListingData
  ): Promise<ListingResponse> {
    try {
      const payload = {
        quantity: listingData.quantity,
        title: listingData.title,
        description: listingData.description,
        price: listingData.price,
        who_made: "i_did", // Required field
        when_made: "made_to_order", // Required field
        taxonomy_id: listingData.category_id || 1, // Default to "Other"
        tags: listingData.tags || [],
      }

      const response = await axios.post(
        `${this.baseUrl}/application/shops/${shopId}/listings`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "x-api-key": this.clientId,
            "Content-Type": "application/json",
          },
        }
      )

      const listing = response.data

      return {
        listing_id: listing.listing_id.toString(),
        listing_url: listing.url,
        status: listing.state,
        raw: listing,
      }
    } catch (error: any) {
      console.error("[EtsyService] Failed to create listing:", error.response?.data || error.message)
      throw new Error(`Failed to create listing: ${error.response?.data?.error || error.message}`)
    }
  }

  /**
   * Update an existing listing.
   * 
   * @param accessToken - OAuth access token
   * @param listingId - Etsy listing ID
   * @param listingData - Updated listing details
   */
  async updateListing(
    accessToken: string,
    listingId: string,
    listingData: Partial<ListingData>
  ): Promise<ListingResponse> {
    try {
      const response = await axios.patch(
        `${this.baseUrl}/application/listings/${listingId}`,
        listingData,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "x-api-key": this.clientId,
            "Content-Type": "application/json",
          },
        }
      )

      const listing = response.data

      return {
        listing_id: listing.listing_id.toString(),
        listing_url: listing.url,
        status: listing.state,
        raw: listing,
      }
    } catch (error: any) {
      console.error("[EtsyService] Failed to update listing:", error.response?.data || error.message)
      throw new Error(`Failed to update listing: ${error.response?.data?.error || error.message}`)
    }
  }

  /**
   * Upload images to a listing.
   * 
   * @param accessToken - OAuth access token
   * @param shopId - Etsy shop ID
   * @param listingId - Etsy listing ID
   * @param imageUrls - Array of image URLs to upload
   */
  async uploadImages(
    accessToken: string,
    shopId: string,
    listingId: string,
    imageUrls: string[]
  ): Promise<any[]> {
    const uploadedImages: any[] = []

    for (const imageUrl of imageUrls) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/application/shops/${shopId}/listings/${listingId}/images`,
          {
            image_url: imageUrl,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "x-api-key": this.clientId,
              "Content-Type": "application/json",
            },
          }
        )

        uploadedImages.push(response.data)
      } catch (error: any) {
        console.error(`[EtsyService] Failed to upload image ${imageUrl}:`, error.response?.data || error.message)
        // Continue with other images even if one fails
      }
    }

    return uploadedImages
  }
}
