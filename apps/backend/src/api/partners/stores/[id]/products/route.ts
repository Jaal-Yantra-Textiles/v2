import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  logWorkflowPhases,
  validatePartnerStoreAccess,
} from "../../../helpers"
import listStoreProductsWorkflow from "../../../../../workflows/partner/list-store-products"
import { createPartnerProductWorkflow } from "../../../../../workflows/partner/create-partner-product"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  // Auth is all this route contributes — the listing (and its response shape)
  // belongs to the workflow so the admin inspection mirror runs the same code
  // rather than a second copy of it (#843).
  const { result } = await listStoreProductsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      storeId: store.id,
    },
  })

  res.json(result)
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const t0 = Date.now()

  const { partner, store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  // Everything past auth — sales-channel injection, the #859 artisan proposal
  // gate, inventory-level seeding and the FX fanout — lives in
  // `create-partner-product` so this route and the legacy
  // `POST /partners/products` cannot drift apart again (#1380).
  const { result } = await createPartnerProductWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      storeId: store.id,
      product: req.body as Record<string, any>,
      // This route has always tolerated a store with no default sales channel.
      requireSalesChannel: false,
    },
  })

  logWorkflowPhases(
    logger,
    "partners/stores/products",
    req.get("x-request-id") || "-",
    Date.now() - t0,
    result.phases
  )

  res.status(201).json({ product: result.product })
}
