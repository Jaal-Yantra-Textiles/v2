import axios from "axios"

export interface GoogleMerchantCredentials {
  client_id: string
  client_secret: string
  redirect_uri: string
  merchant_id?: string
}

export interface GoogleTokenData {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  scope?: string
  retrieved_at?: number
}

export interface GoogleMerchantProductPayload {
  offerId: string
  title: string
  description?: string
  link: string
  imageLink?: string
  additionalImageLinks?: string[]
  contentLanguage: string
  feedLabel: string
  availability?: "in_stock" | "out_of_stock" | "preorder" | "backorder"
  condition?: "new" | "refurbished" | "used"
  price?: { amountMicros: string; currencyCode: string }
  brand?: string
  gtin?: string
  mpn?: string
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const DEFAULT_SCOPE = "https://www.googleapis.com/auth/content"
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
const MERCHANT_API_BASE = "https://merchantapi.googleapis.com/products/v1beta"
const DATASOURCES_API_BASE = "https://merchantapi.googleapis.com/datasources/v1beta"

export type DataSourceChannel = "ONLINE_PRODUCTS" | "LOCAL_PRODUCTS" | "PRODUCTS"

export interface GoogleDataSource {
  name: string
  dataSourceId: string
  displayName: string
  input?: "API" | "FILE" | "UI" | "AUTOFEED"
  primaryProductDataSource?: {
    feedLabel?: string
    contentLanguage?: string
    channel?: DataSourceChannel
  }
}

export interface GoogleProductInput {
  name: string
  offerId: string
  contentLanguage?: string
  feedLabel?: string
  dataSource?: string
  product?: Record<string, any>
}

export class GoogleMerchantProvider {
  private creds: GoogleMerchantCredentials

  constructor(creds: GoogleMerchantCredentials) {
    this.creds = creds
  }

  getAuthorizationUrl(state: string, scope?: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.creds.client_id,
      redirect_uri: this.creds.redirect_uri,
      scope: scope || DEFAULT_SCOPE,
      state,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    })
    return `${AUTH_URL}?${params.toString()}`
  }

  async exchangeCodeForToken(code: string): Promise<GoogleTokenData> {
    try {
      const response = await axios.post(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: this.creds.client_id,
          client_secret: this.creds.client_secret,
          redirect_uri: this.creds.redirect_uri,
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        token_type: response.data.token_type || "Bearer",
        expires_in: response.data.expires_in,
        scope: response.data.scope,
        retrieved_at: Date.now(),
      }
    } catch (error: any) {
      const msg = error.response?.data?.error_description || error.response?.data?.error || error.message
      throw new Error(`Google token exchange failed: ${msg}`)
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleTokenData> {
    try {
      const response = await axios.post(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.creds.client_id,
          client_secret: this.creds.client_secret,
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
      return {
        access_token: response.data.access_token,
        refresh_token: refreshToken,
        token_type: response.data.token_type || "Bearer",
        expires_in: response.data.expires_in,
        scope: response.data.scope,
        retrieved_at: Date.now(),
      }
    } catch (error: any) {
      const msg = error.response?.data?.error_description || error.response?.data?.error || error.message
      throw new Error(`Google token refresh failed: ${msg}`)
    }
  }

  async getUserInfo(accessToken: string): Promise<{ email?: string; sub?: string; name?: string }> {
    const response = await axios.get(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return response.data
  }

  async insertProduct(
    accessToken: string,
    merchantId: string,
    payload: GoogleMerchantProductPayload,
    dataSourceName?: string
  ): Promise<{ name: string; offerId: string; raw: any }> {
    const ds = dataSourceName || `accounts/${merchantId}/dataSources/primary`
    try {
      const response = await axios.post(
        `${MERCHANT_API_BASE}/accounts/${merchantId}/productInputs:insert?dataSource=${encodeURIComponent(ds)}`,
        {
          channel: "ONLINE",
          offerId: payload.offerId,
          contentLanguage: payload.contentLanguage,
          feedLabel: payload.feedLabel,
          product: {
            title: payload.title,
            description: payload.description,
            link: payload.link,
            imageLink: payload.imageLink,
            additionalImageLinks: payload.additionalImageLinks,
            availability: payload.availability || "in_stock",
            condition: payload.condition || "new",
            price: payload.price,
            brand: payload.brand,
            gtin: payload.gtin,
            mpn: payload.mpn,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      )
      return {
        name: response.data.name,
        offerId: response.data.offerId,
        raw: response.data,
      }
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message
      throw new Error(`Google Merchant product insert failed: ${msg}`)
    }
  }

  async deleteProduct(
    accessToken: string,
    productName: string,
    dataSourceName?: string
  ): Promise<void> {
    try {
      await axios.delete(`https://merchantapi.googleapis.com/products/v1beta/${productName}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: dataSourceName ? { dataSource: dataSourceName } : undefined,
      })
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message
      throw new Error(`Google Merchant product delete failed: ${msg}`)
    }
  }

  async listDataSources(accessToken: string, merchantId: string): Promise<GoogleDataSource[]> {
    try {
      const response = await axios.get(
        `${DATASOURCES_API_BASE}/accounts/${merchantId}/dataSources`,
        { headers: { Authorization: `Bearer ${accessToken}` }, params: { pageSize: 250 } }
      )
      return response.data?.dataSources || []
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message
      throw new Error(`Google Merchant listDataSources failed: ${msg}`)
    }
  }

  async createPrimaryApiDataSource(
    accessToken: string,
    merchantId: string,
    input: {
      displayName: string
      contentLanguage: string
      feedLabel: string
      channel?: DataSourceChannel
      countries?: string[]
    }
  ): Promise<GoogleDataSource> {
    try {
      const inferredCountries =
        input.countries && input.countries.length > 0
          ? input.countries
          : /^[A-Z]{2}$/.test(input.feedLabel)
            ? [input.feedLabel]
            : undefined
      const response = await axios.post(
        `${DATASOURCES_API_BASE}/accounts/${merchantId}/dataSources`,
        {
          displayName: input.displayName,
          primaryProductDataSource: {
            channel: input.channel || "ONLINE_PRODUCTS",
            contentLanguage: input.contentLanguage,
            feedLabel: input.feedLabel,
            ...(inferredCountries ? { countries: inferredCountries } : {}),
          },
        },
        {
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        }
      )
      return response.data
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message
      throw new Error(`Google Merchant createDataSource failed: ${msg}`)
    }
  }

  /**
   * Lists computed products for the account. Merchant API v1beta only exposes list
   * on `products` (the processed/unified view), not on `productInputs`. Each item
   * includes `offerId` and `dataSource`, which is what we need for import + takeover.
   */
  async listProducts(
    accessToken: string,
    merchantId: string,
    opts?: { pageSize?: number; pageToken?: string }
  ): Promise<{ products: GoogleProductInput[]; nextPageToken?: string }> {
    try {
      const response = await axios.get(
        `${MERCHANT_API_BASE}/accounts/${merchantId}/products`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            pageSize: opts?.pageSize || 100,
            pageToken: opts?.pageToken,
          },
        }
      )
      return {
        products: response.data?.products || [],
        nextPageToken: response.data?.nextPageToken,
      }
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message
      throw new Error(`Google Merchant listProducts failed: ${msg}`)
    }
  }
}
