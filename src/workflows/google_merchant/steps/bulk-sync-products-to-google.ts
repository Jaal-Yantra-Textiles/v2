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

const LINK_ENTITY = "product_product_google_merchant_google_merchant_account"

export type BulkSyncInput = {
  job_id: string
  account_id: string
  product_ids?: string[]
  content_language?: string
  feed_label?: string
  currency_code?: string
  landing_url_base?: string
}

export const bulkSyncProductsToGoogleStep = createStep(
  "bulk-sync-products-to-google-step",
  async (input: BulkSyncInput, { container }) => {
    const logger = container.resolve("logger") as any
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const service = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService

    const [account] = await service.listGoogleMerchantAccounts({ id: input.account_id }, { take: 1 })
    if (!account) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Account ${input.account_id} not found`)
    if (!account.refresh_token) {
      await failJob(service, input.job_id, "Account not authenticated — complete OAuth first")
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Account not authenticated")
    }

    await service.updateGoogleMerchantSyncJobs({
      id: input.job_id,
      status: "processing",
      started_at: new Date(),
    })

    const productFilter: Record<string, any> = {}
    if (input.product_ids?.length) productFilter.id = input.product_ids

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
      filters: productFilter,
    } as any)

    const total = products?.length || 0
    await service.updateGoogleMerchantSyncJobs({ id: input.job_id, total_products: total })

    if (total === 0) {
      await service.updateGoogleMerchantSyncJobs({
        id: input.job_id,
        status: "completed",
        completed_at: new Date(),
      })
      return new StepResponse({ job_id: input.job_id, total: 0, synced: 0, failed: 0 })
    }

    const clientSecret = encryption.decrypt(account.client_secret as any)
    const refreshToken = encryption.decrypt(account.refresh_token as any)
    const provider = new GoogleMerchantProvider({
      client_id: account.client_id,
      client_secret: clientSecret,
      redirect_uri: account.redirect_uri,
      merchant_id: account.merchant_id,
    })

    const refreshed = await provider.refreshAccessToken(refreshToken)
    const accessToken = refreshed.access_token
    await service.updateGoogleMerchantAccounts({
      id: account.id,
      access_token: JSON.stringify(encryption.encrypt(accessToken)),
      token_expires_at: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null,
    })

    const contentLanguage = input.content_language || (account.api_config as any)?.content_language || "en"
    const feedLabel = input.feed_label || (account.api_config as any)?.feed_label || "US"
    const currencyCode = input.currency_code || (account.api_config as any)?.currency_code || "USD"
    const landingBase =
      input.landing_url_base || (account.api_config as any)?.landing_url_base || process.env.STORE_URL || ""

    if (!landingBase) {
      await failJob(service, input.job_id, "landing_url_base not configured")
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "landing_url_base not configured")
    }

    let synced = 0
    let failed = 0
    const errors: Array<{ product_id: string; error: string }> = []

    for (const product of products) {
      const validation = validateProductForGoogle(product)
      if (!validation.valid) {
        failed++
        errors.push({ product_id: product.id, error: validation.error! })
        await writeLinkSafe(remoteLink, query, product.id, account.id, {
          sync_status: "failed",
          sync_error: validation.error,
        })
        await maybeReportProgress(service, input.job_id, synced, failed)
        continue
      }

      const payload = mapProductToGoogleMerchant(product, {
        offerId: product.handle || product.id,
        link: `${landingBase.replace(/\/$/, "")}/products/${product.handle}`,
        contentLanguage,
        feedLabel,
        currencyCode,
      })

      try {
        const result = await provider.insertProduct(
          accessToken,
          account.merchant_id,
          payload,
          (account.api_config as any)?.data_source_name
        )
        await writeLinkSafe(remoteLink, query, product.id, account.id, {
          sync_status: "synced",
          google_product_id: result.offerId,
          google_product_name: result.name,
          last_synced_at: new Date(),
          sync_error: null,
        })
        synced++
      } catch (e: any) {
        failed++
        const msg = e.message || "Unknown error"
        errors.push({ product_id: product.id, error: msg })
        await writeLinkSafe(remoteLink, query, product.id, account.id, {
          sync_status: "failed",
          sync_error: msg,
        })
        logger?.warn?.(`[bulk-sync] product ${product.id} failed: ${msg}`)
      }

      await maybeReportProgress(service, input.job_id, synced, failed)
    }

    await service.updateGoogleMerchantSyncJobs({
      id: input.job_id,
      status: failed > 0 && synced === 0 ? "failed" : "completed",
      synced_count: synced,
      failed_count: failed,
      error_log: errors.length ? (errors as any) : null,
      completed_at: new Date(),
    })

    return new StepResponse({ job_id: input.job_id, total, synced, failed })
  }
)

async function failJob(service: GoogleMerchantService, job_id: string, error: string) {
  try {
    await service.updateGoogleMerchantSyncJobs({
      id: job_id,
      status: "failed",
      error_log: { error } as any,
      completed_at: new Date(),
    })
  } catch {}
}

async function maybeReportProgress(
  service: GoogleMerchantService,
  job_id: string,
  synced: number,
  failed: number
) {
  if ((synced + failed) % 5 !== 0) return
  try {
    await service.updateGoogleMerchantSyncJobs({
      id: job_id,
      synced_count: synced,
      failed_count: failed,
    })
  } catch {}
}

async function writeLinkSafe(
  remoteLink: Link,
  query: Omit<RemoteQueryFunction, symbol>,
  product_id: string,
  account_id: string,
  data: Record<string, any>
) {
  const definition = {
    [Modules.PRODUCT]: { product_id },
    [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: account_id },
  }
  try {
    const { data: existing } = await query.graph({
      entity: LINK_ENTITY,
      fields: ["google_product_id", "google_product_name", "sync_status"],
      filters: { product_id, google_merchant_account_id: account_id },
    } as any)
    const prior = (existing?.[0] as Record<string, any>) || null
    if (!prior) {
      await remoteLink.create([{ ...definition, data }])
      return
    }
    const merged = { ...prior, ...data }
    await remoteLink.dismiss([definition])
    await remoteLink.create([{ ...definition, data: merged }])
  } catch {
    // best-effort — a link write failure should not abort the batch
  }
}
