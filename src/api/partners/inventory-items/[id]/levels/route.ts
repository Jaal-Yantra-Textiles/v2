import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { id } = req.params
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  const [levels, count] = await inventoryService.listAndCountInventoryLevels(
    { inventory_item_id: id },
    { take: 100 }
  )

  res.json({
    inventory_levels: levels || [],
    count,
    offset: 0,
    limit: 100,
  })
}
