import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import {
  ensureInventoryLevelsForVariants,
  validatePartnerStoreAccess,
} from "../../../helpers"
import listStoreProductsWorkflow from "../../../../../workflows/partner/list-store-products"
import { fanoutVariantPrices } from "../../../../../workflows/fx/fanout-variant-prices"
import {
  isCoreChannelListingPartner,
  recordArtisanProposal,
} from "../../../products/lib/artisan-proposal"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const { result: links } = await listStoreProductsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      storeId: store.id,
    },
  })

  const products = ((links as any[]) || [])
    .map((l: any) => l?.product)
    .filter(Boolean)

  res.json({
    products,
    count: products.length,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>

  // Inject the store's default sales channel
  if (store.default_sales_channel_id) {
    body.sales_channels = [{ id: store.default_sales_channel_id }]
  }

  // #859 S2 (#861) — artisan proposal gate. A `core_channel_listing` partner
  // (Airbnb-style seller) never publishes directly: their products enter as
  // `proposed` and an admin verifies/approves before publish + cross-list.
  // This is the route the partner-ui actually calls, so the gate must live
  // here (not only on the legacy `POST /partners/products`).
  const isCoreChannelListing = await isCoreChannelListingPartner(
    req.scope,
    partner.id
  )
  if (isCoreChannelListing) {
    // Proposal override wins over any client-supplied status.
    body.status = "proposed"
  }

  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [body] as any,
    },
  })

  const product = result[0]

  // Record ownership link + emit `partner_product.proposed` so the admin-review
  // widget, notifications and visual flows can resolve the owning partner.
  if (isCoreChannelListing && product?.id) {
    await recordArtisanProposal(req.scope, partner.id, product.id)
  }

  // Auto-seed inventory_level rows at the partner's stock location(s) for
  // any managed-inventory variants on the new product. Without this, the
  // partner-ui inventory page 404s on those items.
  const variantIds = (product?.variants || []).map((v: any) => v.id)
  await ensureInventoryLevelsForVariants(req.scope, store, variantIds)

  // FX fanout — materialise auto-converted prices in the store's other
  // supported currencies so the product isn't "not available" in non-native
  // regions. Idempotent + never throws (see fanout-variant-prices.ts).
  await fanoutVariantPrices(req.scope, { storeId: store.id, variantIds })

  res.status(201).json({ product })
}
