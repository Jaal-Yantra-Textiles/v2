import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../helpers"
import listStoreProductsWorkflow from "../../../../../workflows/partner/list-store-products"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const adminId = req.auth_context?.actor_id
  if (!adminId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  const partner = await refetchPartnerForThisAdmin(adminId, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this admin")
  }

  const storeId = req.params.id
  if (!storeId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Store id is required in path")
  }

  // Enforce ownership: ensure the requested store is linked to this partner
  
  // Delegate product listing to workflow
  const { result: links } = await listStoreProductsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      storeId,
    },
  })

  const products = (links as any[]) || []
  const count = products.length

  return res.status(200).json({
    partner_id: partner.id,
    store_id: storeId,
    count,
    products,
  })
}
