import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import { mapProductToGoogleMerchant, validateProductForGoogle } from "./map-product-to-google"
import productGoogleMerchantLink from "../../../links/product-google-merchant-link"

const LINK_ENTRY = productGoogleMerchantLink.entryPoint

export type SyncProductToGoogleInput = {
  product_id: string
  account_id: string
  content_language?: string
  feed_label?: string
  currency_code?: string
  landing_url_base?: string
  takeover?: boolean
}

type SyncCompensationState = {
  product_id: string
  account_id: string
  google_product_name: string
  link_existed_before: boolean
  previous_link_data: Record<string, any> | null
}

export const syncProductToGoogleStep = createStep(
  "sync-product-to-google-step",
  async (input: SyncProductToGoogleInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const googleMerchantService = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

    const { account, provider, accessToken } = await googleMerchantService.getAuthedProvider(input.account_id)

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

    const priorLink = await readExistingLink(query, input.product_id, input.account_id)

    if (priorLink?.metadata?.externally_managed && !input.takeover) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Product is managed in Google Merchant Center UI (or a non-API data source). Use the Take over action before syncing, or delete the existing listing in Merchant Center first."
      )
    }

    const validation = validateProductForGoogle(product)
    if (!validation.valid) {
      await upsertLink(remoteLink, query, input.product_id, input.account_id, {
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

    const dataSourceName = (account.api_config as any)?.data_source_name as string | undefined

    try {
      const result = await provider.insertProduct(accessToken!, account.merchant_id, payload, dataSourceName)
      await upsertLink(remoteLink, query, input.product_id, input.account_id, {
        sync_status: "synced",
        google_product_id: result.offerId,
        google_product_name: result.name,
        last_synced_at: new Date(),
        sync_error: null,
        metadata: {
          ...(priorLink?.metadata || {}),
          synced_at: new Date().toISOString(),
          source_data_source: dataSourceName || null,
          externally_managed: false,
        },
      })

      const compensationState: SyncCompensationState = {
        product_id: input.product_id,
        account_id: input.account_id,
        google_product_name: result.name,
        link_existed_before: !!priorLink,
        previous_link_data: priorLink,
      }

      return new StepResponse(
        {
          success: true,
          google_product_id: result.offerId,
          google_product_name: result.name,
        },
        compensationState
      )
    } catch (error: any) {
      await upsertLink(remoteLink, query, input.product_id, input.account_id, {
        sync_status: "failed",
        sync_error: error.message || "Unknown error",
      })
      throw error
    }
  },
  async (state: SyncCompensationState | undefined, { container }) => {
    if (!state) return
    const logger = container.resolve("logger") as any
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const googleMerchantService = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

    try {
      const { provider, accessToken } = await googleMerchantService.getAuthedProvider(state.account_id)
      await provider.deleteProduct(accessToken, state.google_product_name)
    } catch (e: any) {
      logger?.warn?.(
        `[sync-product-to-google compensate] Google delete failed for ${state.google_product_name}: ${e.message}`
      )
    }

    if (state.link_existed_before && state.previous_link_data) {
      await upsertLink(
        remoteLink,
        query,
        state.product_id,
        state.account_id,
        state.previous_link_data
      )
    } else {
      try {
        await remoteLink.dismiss([
          {
            [Modules.PRODUCT]: { product_id: state.product_id },
            [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: state.account_id },
          },
        ])
      } catch (e: any) {
        logger?.warn?.(`[sync-product-to-google compensate] dismiss failed: ${e.message}`)
      }
    }
  }
)

async function readExistingLink(
  query: Omit<RemoteQueryFunction, symbol>,
  product_id: string,
  account_id: string
): Promise<Record<string, any> | null> {
  try {
    const { data } = await query.graph({
      entity: LINK_ENTRY,
      fields: [
        "google_product_id",
        "google_product_name",
        "sync_status",
        "sync_error",
        "last_synced_at",
        "metadata",
      ],
      filters: { product_id, google_merchant_account_id: account_id },
    } as any)
    return (data?.[0] as Record<string, any>) || null
  } catch {
    return null
  }
}

async function upsertLink(
  remoteLink: Link,
  query: Omit<RemoteQueryFunction, symbol>,
  product_id: string,
  account_id: string,
  data: Record<string, any>
) {
  const existing = await readExistingLink(query, product_id, account_id)
  const definition = {
    [Modules.PRODUCT]: { product_id },
    [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: account_id },
  }

  if (!existing) {
    await remoteLink.create([{ ...definition, data }])
    return
  }

  // Merge so partial updates don't blank out prior fields.
  const merged = { ...existing, ...data }
  await remoteLink.dismiss([definition])
  await remoteLink.create([{ ...definition, data: merged }])
}
