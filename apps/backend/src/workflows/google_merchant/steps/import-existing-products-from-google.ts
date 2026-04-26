import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import { GoogleProductInput } from "../../../modules/google_merchant/provider"
import productGoogleMerchantLink from "../../../links/product-google-merchant-link"

const LINK_ENTRY = productGoogleMerchantLink.entryPoint

export type ImportExistingInput = {
  account_id: string
  dry_run?: boolean
}

export type ImportExistingOutput = {
  account_id: string
  google_total: number
  matched: number
  linked: number
  refreshed: number
  externally_managed: number
  skipped_existing_link: number
  unmatched: Array<{ offer_id: string; google_name: string }>
  errors: Array<{ offer_id: string; reason: string }>
}

// Normalize an identifier for fuzzy matching: lowercase + collapse `_`/`-` separators.
const normalize = (s: string | null | undefined): string =>
  (s || "").toLowerCase().replace(/[-_\s]+/g, "-").trim()

export const importExistingProductsFromGoogleStep = createStep(
  "import-existing-products-from-google-step",
  async (input: ImportExistingInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const service = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

    const { account, provider, accessToken } = await service.getAuthedProvider(input.account_id, container)

    // Paginate through the account's computed products (Merchant API only supports list on
    // `products`, not `productInputs` — but each Product includes offerId + dataSource).
    const allInputs: GoogleProductInput[] = []
    let pageToken: string | undefined
    let pagesFetched = 0
    do {
      const page = await provider.listProducts(accessToken, account.merchant_id, {
        pageSize: 250,
        pageToken,
      })
      allInputs.push(...page.products)
      pageToken = page.nextPageToken
      pagesFetched++
      if (pagesFetched > 50) break // safety — ~12.5k products
    } while (pageToken)

    if (allInputs.length === 0) {
      return new StepResponse<ImportExistingOutput>({
        account_id: input.account_id,
        google_total: 0,
        matched: 0,
        linked: 0,
        refreshed: 0,
        externally_managed: 0,
        skipped_existing_link: 0,
        unmatched: [],
        errors: [],
      })
    }

    const ourDataSource = (account.api_config as any)?.data_source_name as string | undefined

    // Pull every product with handle + variant SKUs. We match on multiple keys because
    // offerIds may be the handle, a variant SKU, or a normalized form of either.
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "handle", "variants.sku"],
      filters: {} as any,
    } as any)

    const byHandle = new Map<string, string>()
    const byNormalizedHandle = new Map<string, string>()
    const bySku = new Map<string, string>()
    const byNormalizedSku = new Map<string, string>()
    for (const p of (products || []) as Array<{
      id: string
      handle: string | null
      variants?: Array<{ sku: string | null }>
    }>) {
      if (p.handle) {
        byHandle.set(p.handle, p.id)
        byNormalizedHandle.set(normalize(p.handle), p.id)
      }
      for (const v of p.variants || []) {
        if (v?.sku) {
          bySku.set(v.sku, p.id)
          byNormalizedSku.set(normalize(v.sku), p.id)
        }
      }
    }

    // Pull existing links so we can refresh same-source matches instead of silently skipping.
    const { data: existingLinks } = await query.graph({
      entity: LINK_ENTRY,
      fields: ["product_id", "google_merchant_account_id"],
      filters: { google_merchant_account_id: input.account_id } as any,
    } as any)
    const linkedProductIds = new Set(
      ((existingLinks || []) as Array<{ product_id: string }>).map((l) => l.product_id)
    )

    const unmatched: Array<{ offer_id: string; google_name: string }> = []
    const errors: Array<{ offer_id: string; reason: string }> = []
    let matched = 0
    let linked = 0
    let refreshed = 0
    let skipped = 0
    let externallyManaged = 0

    const resolveProductId = (offerId: string): string | undefined => {
      return (
        byHandle.get(offerId) ||
        bySku.get(offerId) ||
        byNormalizedHandle.get(normalize(offerId)) ||
        byNormalizedSku.get(normalize(offerId))
      )
    }

    for (const gp of allInputs) {
      const productId = resolveProductId(gp.offerId)
      if (!productId) {
        unmatched.push({ offer_id: gp.offerId, google_name: gp.name })
        continue
      }
      matched++

      const sourceDs = gp.dataSource || null
      const isSameSource = !!sourceDs && !!ourDataSource && sourceDs === ourDataSource
      const isExternallyManaged = !!sourceDs && !!ourDataSource && sourceDs !== ourDataSource
      if (isExternallyManaged) externallyManaged++

      const alreadyLinked = linkedProductIds.has(productId)

      // Skip non-same-source products that already have a link — we don't want to
      // overwrite externally-managed link metadata the user may have customized.
      if (alreadyLinked && !isSameSource) {
        skipped++
        continue
      }

      if (input.dry_run) continue

      const definition = {
        [Modules.PRODUCT]: { product_id: productId },
        [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: input.account_id },
      }
      const data = {
        sync_status: "synced",
        google_product_id: gp.offerId,
        google_product_name: gp.name,
        last_synced_at: new Date(),
        sync_error: null,
        metadata: {
          imported: true,
          imported_at: new Date().toISOString(),
          source_data_source: sourceDs,
          externally_managed: isExternallyManaged,
        },
      }

      try {
        if (alreadyLinked) {
          // Upsert: dismiss the prior link then recreate with fresh data.
          await remoteLink.dismiss([definition])
          await remoteLink.create([{ ...definition, data }])
          refreshed++
        } else {
          await remoteLink.create([{ ...definition, data }])
          linked++
        }
      } catch (err: any) {
        errors.push({
          offer_id: gp.offerId,
          reason: err?.message || "link write failed",
        })
      }
    }

    return new StepResponse<ImportExistingOutput>({
      account_id: input.account_id,
      google_total: allInputs.length,
      matched,
      linked,
      refreshed,
      externally_managed: externallyManaged,
      skipped_existing_link: skipped,
      unmatched,
      errors,
    })
  }
)
