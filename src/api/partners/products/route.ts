import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PartnerCreateProductReq } from "./validators"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { refetchPartnerForThisAdmin } from "../helpers"

export const POST = async (
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

  const body = PartnerCreateProductReq.parse(req.body)

  // Fetch target store and determine the sales channel to associate the product with
  const storeService = req.scope.resolve(Modules.STORE)
  const [store] = await storeService.listStores({ id: body.store_id })
  if (!store) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Store ${body.store_id} not found`)
  }
  if (!store.default_sales_channel_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Store ${body.store_id} has no default sales channel configured`
    )
  }

  // Ensure product is associated to the store's default sales channel
  const productInput = {
    ...body.product,
    title: body.product.title || "",
    sales_channels: [
      {
        id: store.default_sales_channel_id,
      },
    ],
  }

  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [productInput],
    },
  })

  const created = result?.[0]

  return res.status(201).json({
    message: "Product created",
    partner_id: partner.id,
    store_id: store.id,
    product: created,
  })
}
