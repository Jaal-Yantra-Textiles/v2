import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import type EncryptionService from "../../../modules/encryption/service"
import { GoogleMerchantProvider } from "../../../modules/google_merchant/provider"
import { mapProductToGoogleMerchant, validateProductForGoogle } from "./map-product-to-google"

export type SyncProductToGoogleInput = {
  product_id: string
  account_id: string
  content_language?: string
  feed_label?: string
  currency_code?: string
  landing_url_base?: string
}

export const syncProductToGoogleStep = createStep(
  "sync-product-to-google-step",
  async (input: SyncProductToGoogleInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const googleMerchantService = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService

    const [account] = await googleMerchantService.listGoogleMerchantAccounts(
      { id: input.account_id },
      { take: 1 }
    )

    if (!account) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Google Merchant account ${input.account_id} not found`)
    }
    if (!account.refresh_token) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Account ${input.account_id} is not authenticated — complete OAuth first`)
    }
    if (!account.merchant_id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Account ${input.account_id} is missing merchant_id`)
    }

    const clientSecret = encryption.decrypt(account.client_secret as any)
    const refreshToken = encryption.decrypt(account.refresh_token as any)

    const provider = new GoogleMerchantProvider({
      client_id: account.client_id,
      client_secret: clientSecret,
      redirect_uri: account.redirect_uri,
      merchant_id: account.merchant_id,
    })

    let accessToken = account.access_token || undefined
    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0
    if (!accessToken || Date.now() > expiresAt - 60_000) {
      const refreshed = await provider.refreshAccessToken(refreshToken)
      accessToken = refreshed.access_token
      await googleMerchantService.updateGoogleMerchantAccounts({
        id: account.id,
        access_token: refreshed.access_token,
        token_expires_at: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null,
      })
    }

    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "subtitle",
        "description",
        "handle",
        "metadata",
        "variants.*",
        "variants.prices.*",
        "images.*",
      ],
      filters: { id: input.product_id },
    })

    const product = products?.[0]
    if (!product) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${input.product_id} not found`)
    }

    const validation = validateProductForGoogle(product)
    if (!validation.valid) {
      await upsertLink(remoteLink, input.product_id, input.account_id, {
        sync_status: "failed",
        sync_error: validation.error!,
      })
      throw new MedusaError(MedusaError.Types.INVALID_DATA, validation.error!)
    }

    const contentLanguage = input.content_language || (account.api_config as any)?.content_language || "en"
    const feedLabel = input.feed_label || (account.api_config as any)?.feed_label || "US"
    const currencyCode = input.currency_code || (account.api_config as any)?.currency_code || "USD"
    const landingBase = input.landing_url_base || (account.api_config as any)?.landing_url_base || process.env.STORE_URL || ""

    if (!landingBase) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "landing_url_base not configured — set on the account api_config or pass in request"
      )
    }

    const payload = mapProductToGoogleMerchant(product, {
      offerId: product.handle || product.id,
      link: `${landingBase.replace(/\/$/, "")}/products/${product.handle}`,
      contentLanguage,
      feedLabel,
      currencyCode,
    })

    try {
      const result = await provider.insertProduct(accessToken!, account.merchant_id, payload)
      await upsertLink(remoteLink, input.product_id, input.account_id, {
        sync_status: "synced",
        google_product_id: result.offerId,
        google_product_name: result.name,
        last_synced_at: new Date(),
        sync_error: null,
        metadata: { synced_at: new Date().toISOString() },
      })
      return new StepResponse({
        success: true,
        google_product_id: result.offerId,
        google_product_name: result.name,
      })
    } catch (error: any) {
      await upsertLink(remoteLink, input.product_id, input.account_id, {
        sync_status: "failed",
        sync_error: error.message || "Unknown error",
      })
      throw error
    }
  }
)

async function upsertLink(remoteLink: Link, product_id: string, account_id: string, data: Record<string, any>) {
  try {
    await remoteLink.dismiss([
      {
        [Modules.PRODUCT]: { product_id },
        [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: account_id },
      },
    ])
  } catch {}
  await remoteLink.create([
    {
      [Modules.PRODUCT]: { product_id },
      [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: account_id },
      data,
    },
  ])
}
