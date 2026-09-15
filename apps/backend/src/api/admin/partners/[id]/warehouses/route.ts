import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createPartnerWarehouseWorkflow } from "../../../../../workflows/partners/create-partner-warehouse"
import { CreatePartnerWarehouseReq } from "../../../../partners/warehouses/validators"

/**
 * Admin-side warehouse provisioning for a partner (#2061 item 4).
 *
 * `POST /partners/warehouses` is partner-portal only, so until now an admin
 * could not give a partner anywhere to put goods — they had to ask the partner
 * to do it themselves, or mint a whole store on their behalf. 12 partners on
 * prod still have no warehouse, and their completed runs cannot bank output.
 *
 * Same workflow as the partner route, including the single-warehouse guard.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partnerId = req.params.id
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "partners",
    fields: [
      "stock_locations.id",
      "stock_locations.name",
      "stock_locations.address.*",
      "stock_locations.metadata",
    ],
    filters: { id: partnerId },
  })

  const warehouses = (data?.[0]?.stock_locations || []).filter((l: any) => l?.id)

  return res.json({
    partner_id: partnerId,
    count: warehouses.length,
    warehouses,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partnerId = req.params.id
  const body = CreatePartnerWarehouseReq.parse(req.body)

  const { result } = await createPartnerWarehouseWorkflow(req.scope).run({
    input: { partner_id: partnerId, ...body },
  })

  return res.status(201).json({
    message: "Warehouse created",
    partner_id: partnerId,
    warehouse: result.location,
  })
}
