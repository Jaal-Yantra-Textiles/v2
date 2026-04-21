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
  externally_managed: number
  skipped_existing_link: number
  unmatched: Array<{ offer_id: string; google_name: string }>
}

export const importExistingProductsFromGoogleStep = createStep(
  "import-existing-products-from-google-step",
  async (input: ImportExistingInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const service = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

    const { account, provider, accessToken } = await service.getAuthedProvider(input.account_id)

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
        externally_managed: 0,
        skipped_existing_link: 0,
        unmatched: [],
      })
    }

    const ourDataSource = (account.api_config as any)?.data_source_name as string | undefined

    // Look up Medusa products whose handle matches any Google offerId
    const offerIds = allInputs.map((p) => p.offerId).filter(Boolean)
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "handle"],
      filters: { handle: offerIds } as any,
    } as any)

    const handleToProductId = new Map<string, string>()
    for (const p of (products || []) as Array<{ id: string; handle: string }>) {
      if (p.handle) handleToProductId.set(p.handle, p.id)
    }

    // Look up existing links for this account so we don't overwrite
    const { data: existingLinks } = await query.graph({
      entity: LINK_ENTRY,
      fields: ["product_id", "google_merchant_account_id"],
      filters: { google_merchant_account_id: input.account_id } as any,
    } as any)
    const linkedProductIds = new Set(
      ((existingLinks || []) as Array<{ product_id: string }>).map((l) => l.product_id)
    )

    const unmatched: Array<{ offer_id: string; google_name: string }> = []
    let matched = 0
    let linked = 0
    let skipped = 0
    let externallyManaged = 0

    for (const gp of allInputs) {
      const productId = handleToProductId.get(gp.offerId)
      if (!productId) {
        unmatched.push({ offer_id: gp.offerId, google_name: gp.name })
        continue
      }
      matched++

      if (linkedProductIds.has(productId)) {
        skipped++
        continue
      }

      const sourceDs = gp.dataSource || null
      const isExternallyManaged = !!sourceDs && !!ourDataSource && sourceDs !== ourDataSource
      if (isExternallyManaged) externallyManaged++

      if (input.dry_run) continue

      try {
        await remoteLink.create([
          {
            [Modules.PRODUCT]: { product_id: productId },
            [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: input.account_id },
            data: {
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
            },
          },
        ])
        linked++
      } catch {
        skipped++
      }
    }

    return new StepResponse<ImportExistingOutput>({
      account_id: input.account_id,
      google_total: allInputs.length,
      matched,
      linked,
      externally_managed: externallyManaged,
      skipped_existing_link: skipped,
      unmatched,
    })
  }
)
