import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import { GoogleProductInput } from "../../../modules/google_merchant/provider"
import productGoogleMerchantLink from "../../../links/product-google-merchant-link"

const LINK_ENTRY = productGoogleMerchantLink.entryPoint

const normalize = (s: string | null | undefined): string =>
  (s || "").toLowerCase().replace(/[-_\s]+/g, "-").trim()

export type PreviewImportInput = {
  account_id: string
}

export type PreviewMatchReason = "handle" | "sku" | "normalized_handle" | "normalized_sku"

export type PreviewImportItem = {
  offer_id: string
  google_name: string
  data_source: string | null
  content_language: string | null
  feed_label: string | null
  is_externally_managed: boolean
  suggested_product_id: string | null
  suggested_product_handle: string | null
  suggested_match_reason: PreviewMatchReason | null
  existing_link: {
    product_id: string
    is_same_source: boolean
  } | null
}

export type PreviewImportOutput = {
  account_id: string
  google_total: number
  our_data_source: string | null
  items: PreviewImportItem[]
}

export const previewImportFromGoogleStep = createStep(
  "preview-import-from-google-step",
  async (input: PreviewImportInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const service = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

    const { account, provider, accessToken } = await service.getAuthedProvider(input.account_id, container)

    const allProducts: GoogleProductInput[] = []
    let pageToken: string | undefined
    let pagesFetched = 0
    do {
      const page = await provider.listProducts(accessToken, account.merchant_id, {
        pageSize: 250,
        pageToken,
      })
      allProducts.push(...page.products)
      pageToken = page.nextPageToken
      pagesFetched++
      if (pagesFetched > 50) break
    } while (pageToken)

    const ourDataSource = (account.api_config as any)?.data_source_name as string | undefined

    if (allProducts.length === 0) {
      return new StepResponse<PreviewImportOutput>({
        account_id: input.account_id,
        google_total: 0,
        our_data_source: ourDataSource || null,
        items: [],
      })
    }

    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "handle", "variants.sku"],
      filters: {} as any,
    } as any)

    type ProductRow = {
      id: string
      handle: string | null
      variants?: Array<{ sku: string | null }>
    }

    const byHandle = new Map<string, ProductRow>()
    const byNormalizedHandle = new Map<string, ProductRow>()
    const bySku = new Map<string, ProductRow>()
    const byNormalizedSku = new Map<string, ProductRow>()
    for (const p of (products || []) as ProductRow[]) {
      if (p.handle) {
        byHandle.set(p.handle, p)
        byNormalizedHandle.set(normalize(p.handle), p)
      }
      for (const v of p.variants || []) {
        if (v?.sku) {
          bySku.set(v.sku, p)
          byNormalizedSku.set(normalize(v.sku), p)
        }
      }
    }

    const { data: existingLinks } = await query.graph({
      entity: LINK_ENTRY,
      fields: ["product_id", "google_merchant_account_id", "metadata"],
      filters: { google_merchant_account_id: input.account_id } as any,
    } as any)
    const linksByProductId = new Map<
      string,
      { product_id: string; source_data_source: string | null }
    >()
    for (const l of ((existingLinks || []) as Array<{
      product_id: string
      metadata?: Record<string, any> | null
    }>)) {
      linksByProductId.set(l.product_id, {
        product_id: l.product_id,
        source_data_source: (l.metadata?.source_data_source as string | null) || null,
      })
    }

    const matchProduct = (offerId: string):
      | { product: ProductRow; reason: PreviewMatchReason }
      | null => {
      const exactHandle = byHandle.get(offerId)
      if (exactHandle) return { product: exactHandle, reason: "handle" }
      const exactSku = bySku.get(offerId)
      if (exactSku) return { product: exactSku, reason: "sku" }
      const normHandle = byNormalizedHandle.get(normalize(offerId))
      if (normHandle) return { product: normHandle, reason: "normalized_handle" }
      const normSku = byNormalizedSku.get(normalize(offerId))
      if (normSku) return { product: normSku, reason: "normalized_sku" }
      return null
    }

    const items: PreviewImportItem[] = allProducts.map((gp) => {
      const sourceDs = gp.dataSource || null
      const isExternallyManaged = !!sourceDs && !!ourDataSource && sourceDs !== ourDataSource
      const match = matchProduct(gp.offerId)
      const existing = match ? linksByProductId.get(match.product.id) : undefined

      return {
        offer_id: gp.offerId,
        google_name: gp.name,
        data_source: sourceDs,
        content_language: gp.contentLanguage || null,
        feed_label: gp.feedLabel || null,
        is_externally_managed: isExternallyManaged,
        suggested_product_id: match?.product.id ?? null,
        suggested_product_handle: match?.product.handle ?? null,
        suggested_match_reason: match?.reason ?? null,
        existing_link: existing
          ? {
              product_id: existing.product_id,
              is_same_source:
                !!sourceDs && !!existing.source_data_source && sourceDs === existing.source_data_source,
            }
          : null,
      }
    })

    return new StepResponse<PreviewImportOutput>({
      account_id: input.account_id,
      google_total: allProducts.length,
      our_data_source: ourDataSource || null,
      items,
    })
  }
)
