import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ETSYSYNC_MODULE } from "../../../modules/etsysync"
import { EXTERNAL_STORES_MODULE } from "../../../modules/external_stores"
import EtsysyncService from "../../../modules/etsysync/service"
import ExternalStoresService from "../../../modules/external_stores/service"
import { mapProductToEtsyListing, validateProductForEtsy } from "./map-product-to-etsy"

export type BatchSyncProductsInput = {
  product_ids: string[]
  etsy_account_id: string
  sync_job_id: string
}

/**
 * Syncs products to Etsy and updates the link records with results.
 * 
 * Flow:
 * 1. Fetch product data from MedusaJS
 * 2. Get Etsy account and provider
 * 3. For each product:
 *    - Validate product data
 *    - Map to Etsy listing format
 *    - Create listing via Etsy API
 *    - Upload product images
 *    - Update link record with results
 * 4. Update sync job with final counts
 */
export const batchSyncProductsStep = createStep(
  "batch-sync-products-step",
  async (input: BatchSyncProductsInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    const etsysyncService: EtsysyncService = container.resolve(ETSYSYNC_MODULE)
    const externalStores: ExternalStoresService = container.resolve(EXTERNAL_STORES_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    let syncedCount = 0
    let failedCount = 0
    const errors: Record<string, string> = {}

    // Get Etsy provider (cast to any to access Etsy-specific methods)
    const etsyProvider = externalStores.getProvider("etsy") as any

    // Get Etsy account details
    const [account] = await etsysyncService.listEtsy_accounts(
      { id: input.etsy_account_id },
      { take: 1 }
    )

    if (!account) {
      throw new Error(`Etsy account ${input.etsy_account_id} not found`)
    }

    if (!account.access_token) {
      throw new Error(`Etsy account ${input.etsy_account_id} is not authenticated`)
    }

    // Update sync job to processing
    await etsysyncService.updateEtsy_sync_jobs({
      id: input.sync_job_id,
      status: "processing",
    })

    // Process each product
    for (const product_id of input.product_ids) {
      try {
        // Fetch product data with variants, images, prices
        const { data: products } = await query.graph({
          entity: "product",
          fields: [
            "id",
            "title",
            "description",
            "metadata",
            "tags.*",
            "variants.*",
            "variants.prices.*",
            "images.*",
          ],
          filters: { id: product_id },
        })

        const product = products?.[0]
        if (!product) {
          throw new Error(`Product ${product_id} not found`)
        }

        // Validate product data
        const validation = validateProductForEtsy(product)
        if (!validation.valid) {
          throw new Error(validation.error)
        }

        // Map product to Etsy listing format
        const listingData = mapProductToEtsyListing(product)

        // Create listing on Etsy
        const listing = await etsyProvider.createListing(
          account.access_token,
          account.shop_id,
          listingData
        )

        // Upload images if available
        if (listingData.images && listingData.images.length > 0) {
          try {
            await etsyProvider.uploadImages(
              account.access_token,
              account.shop_id,
              listing.listing_id,
              listingData.images
            )
          } catch (imageError: any) {
            console.warn(`[Etsy Sync] Failed to upload images for product ${product_id}:`, imageError.message)
            // Continue even if image upload fails
          }
        }

        // Update the link record with sync results
        // Links don't have update method, so dismiss and recreate
        await remoteLink.dismiss([
          {
            [Modules.PRODUCT]: {
              product_id,
            },
            [ETSYSYNC_MODULE]: {
              etsy_account_id: input.etsy_account_id,
            },
          },
        ])

        await remoteLink.create([
          {
            [Modules.PRODUCT]: {
              product_id,
            },
            [ETSYSYNC_MODULE]: {
              etsy_account_id: input.etsy_account_id,
            },
            data: {
              sync_status: "synced",
              etsy_listing_id: listing.listing_id,
              etsy_url: listing.listing_url,
              last_synced_at: new Date(),
              sync_error: null,
              metadata: {
                etsy_status: listing.status,
                synced_at: new Date().toISOString(),
              },
            },
          },
        ])

        syncedCount++
      } catch (error: any) {
        failedCount++
        errors[product_id] = error.message || "Unknown error"

        // Update link record with error
        // Links don't have update method, so dismiss and recreate
        await remoteLink.dismiss([
          {
            [Modules.PRODUCT]: {
              product_id,
            },
            [ETSYSYNC_MODULE]: {
              etsy_account_id: input.etsy_account_id,
            },
          },
        ])

        await remoteLink.create([
          {
            [Modules.PRODUCT]: {
              product_id,
            },
            [ETSYSYNC_MODULE]: {
              etsy_account_id: input.etsy_account_id,
            },
            data: {
              sync_status: "failed",
              etsy_listing_id: null,
              etsy_url: null,
              last_synced_at: null,
              sync_error: error.message || "Unknown error",
              metadata: {},
            },
          },
        ])
      }
    }

    // Update sync job with final counts
    await etsysyncService.updateEtsy_sync_jobs({
      id: input.sync_job_id,
      status: failedCount === input.product_ids.length ? "failed" : "completed",
      synced_count: syncedCount,
      failed_count: failedCount,
      error_log: errors,
      completed_at: new Date(),
    })

    return new StepResponse({
      synced_count: syncedCount,
      failed_count: failedCount,
      errors,
    })
  }
)
