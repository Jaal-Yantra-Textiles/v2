import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../helpers"
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

  const products = (links as any[]) || []

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

  res.status(201).json({ product: result[0] })
}
