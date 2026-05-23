import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import {
  ensureInventoryLevelsForVariants,
  validatePartnerStoreAccess,
} from "../../../helpers"
import listStoreProductsWorkflow from "../../../../../workflows/partner/list-store-products"

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
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>

  // Inject the store's default sales channel
  if (store.default_sales_channel_id) {
    body.sales_channels = [{ id: store.default_sales_channel_id }]
  }

  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [body] as any,
    },
  })

  const product = result[0]

  // Auto-seed inventory_level rows at the partner's stock location(s) for
  // any managed-inventory variants on the new product. Without this, the
  // partner-ui inventory page 404s on those items.
  const variantIds = (product?.variants || []).map((v: any) => v.id)
  await ensureInventoryLevelsForVariants(req.scope, store, variantIds)

  res.status(201).json({ product })
}
