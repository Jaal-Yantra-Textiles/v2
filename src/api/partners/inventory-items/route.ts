import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

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

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: items } = await query.graph({
    entity: "inventory_items",
    fields: ["*"],
  })

  res.json({
    inventory_items: items || [],
    count: items?.length || 0,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
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

  const body = req.body as Record<string, any>
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  const item = await inventoryService.createInventoryItems(body)

  res.status(201).json({ inventory_item: item })
}
