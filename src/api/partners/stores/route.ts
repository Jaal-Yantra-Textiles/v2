import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PartnerCreateStoreReq } from "./validators"
import { createStoreWithDefaultsWorkflow } from "../../../workflows/stores/create-store-with-defaults"
import { refetchPartnerForThisAdmin } from "../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const adminId = req.auth_context?.actor_id
  if (!adminId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  // Ensure this admin belongs to a partner
  const partner = await refetchPartnerForThisAdmin(adminId, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this admin")
  }

  // Validate input
  const body = PartnerCreateStoreReq.parse(req.body)

  // Build workflow input: pass explicit partner_id; keep metadata tag for auditing
  const input = {
    partner_id: partner.id,
    ...body,
    store: {
      ...body.store,
      metadata: {
        ...(body.store.metadata || {}),
        partner_id: partner.id,
      },
    },
  }

  const { result } = await createStoreWithDefaultsWorkflow(req.scope).run({
    input,
  })

  return res.status(201).json({
    message: "Store created with defaults",
    partner_id: partner.id,
    store: result.store,
    sales_channel: result.sales_channel,
    region: result.region,
    location: result.location,
  })
}
