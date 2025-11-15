import axios from "axios"
import { StoreProvider, TokenData, ShopInfo, ListingData, ListingResponse } from "./types"

/**
 * Etsy API v3 service implementation.
 * 
 * Docs: https://developers.etsy.com/documentation/
 * 
 * Required environment variables:
 * - ETSY_CLIENT_ID (keystring from Etsy app)
 * - ETSY_CLIENT_SECRET
 * - ETSY_REDIRECT_URI
 * - ETSY_SCOPE (optional, defaults to listings_r listings_w shops_r)
 */
export default class EtsyService implements StoreProvider {
  name = "etsy"
  
  private clientId: string
  private clientSecret: string
  private baseUrl = "https://openapi.etsy.com/v3"
  private authUrl = "https://www.etsy.com/oauth/connect"
  private tokenUrl = "https://api.etsy.com/v3/public/oauth/token"

  constructor() {
    this.clientId = process.env.ETSY_CLIENT_ID || ""
    this.clientSecret = process.env.ETSY_CLIENT_SECRET || ""

    if (!this.clientId || !this.clientSecret) {
      console.warn("[EtsyService] Missing ETSY_CLIENT_ID or ETSY_CLIENT_SECRET environment variables")
    }
  }

  /**
   * Generate Etsy OAuth authorization URL.
   * 
   * @param redirectUri - Callback URL registered in Etsy app
   * @param scope - Space-separated scopes (e.g., "listings_r listings_w shops_r")
   * @param state - CSRF protection state parameter
   */
  async getAuthorizationUrl(redirectUri: string, scope: string, state: string): Promise<string> {
    const defaultScope = "listings_r listings_w shops_r"
    const finalScope = scope || defaultScope

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: finalScope,
      state: state,
    })

    return `${this.authUrl}?${params.toString()}`
  }

  /**
   * Exchange authorization code for access token.
   * 
   * @param code - Authorization code from OAuth callback
   * @param redirectUri - Must match the one used in authorization
   */
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenData> {
    try {
      const response = await axios.post(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: this.clientId,
          code: code,
          redirect_uri: redirectUri,
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
