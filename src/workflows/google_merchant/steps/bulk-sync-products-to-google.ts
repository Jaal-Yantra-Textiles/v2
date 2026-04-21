import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import { mapProductToGoogleMerchant, validateProductForGoogle } from "./map-product-to-google"
import productGoogleMerchantLink from "../../../links/product-google-merchant-link"

const LINK_ENTRY = productGoogleMerchantLink.entryPoint

export type BulkSyncInput = {
  job_id: string
  account_id: string
  product_ids?: string[]
  content_language?: string
  feed_label?: string
  currency_code?: string
  landing_url_base?: string
  include_externally_managed?: boolean
}

export const bulkSyncProductsToGoogleStep = createStep(
  "bulk-sync-products-to-google-step",
  async (input: BulkSyncInput, { container }) => {
    const logger = container.resolve("logger") as any
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const service = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

    let authed: { account: any; provider: any; accessToken: string }
    try {
      authed = await service.getAuthedProvider(input.account_id)
    } catch (e: any) {
      await failJob(service, input.job_id, e?.message || "Failed to authenticate with Google")
      throw e
    }
    const { account, provider, accessToken } = authed

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
    let skippedExternal = 0
    const errors: Array<{ product_id: string; error: string }> = []

    // Pre-fetch externally-managed flag for every product so we can skip them without per-item queries
    const externallyManaged = new Set<string>()
    if (!input.include_externally_managed) {
      try {
        const { data: priorLinks } = await query.graph({
          entity: LINK_ENTRY,
          fields: ["product_id", "metadata"],
          filters: {
            google_merchant_account_id: input.account_id,
            product_id: products.map((p: any) => p.id),
          } as any,
        } as any)
        for (const l of (priorLinks || []) as any[]) {
          if (l?.metadata?.externally_managed && l.product_id) externallyManaged.add(l.product_id)
        }
      } catch {}
    }

    for (const product of products) {
      if (externallyManaged.has(product.id)) {
        skippedExternal++
        continue
      }

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

    const errorLog =
      errors.length || skippedExternal > 0
        ? ({ errors, skipped_externally_managed: skippedExternal } as any)
        : null

    await service.updateGoogleMerchantSyncJobs({
      id: input.job_id,
      status: failed > 0 && synced === 0 ? "failed" : "completed",
      synced_count: synced,
      failed_count: failed,
      error_log: errorLog,
      completed_at: new Date(),
    })

    return new StepResponse({
      job_id: input.job_id,
      total,
      synced,
      failed,
      skipped_externally_managed: skippedExternal,
    })
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
      entity: LINK_ENTRY,
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
