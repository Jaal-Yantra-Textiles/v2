import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { createPartnerWarehouseWorkflow } from "../../../workflows/partners/create-partner-warehouse"
import { getPartnerFromAuthContext } from "../helpers"
import { CreatePartnerWarehouseReq } from "./validators"

/**
 * GET /partners/warehouses — the warehouses this partner holds.
 *
 * Reads the typed `partner → stock_location` link (#2053) rather than walking
 * `partner → store → sales channel → location`, so it answers for a partner
 * with no store at all — which, on prod, is 16 of 30.
 */
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

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partners",
    fields: [
      "stock_locations.id",
      "stock_locations.name",
      "stock_locations.address.*",
      "stock_locations.metadata",
    ],
    filters: { id: partner.id },
  })

  const warehouses = (data?.[0]?.stock_locations || []).filter((l: any) => l?.id)

  return res.json({
    partner_id: partner.id,
    count: warehouses.length,
    warehouses,
  })
}

/**
 * POST /partners/warehouses — somewhere to put goods, without a storefront.
 *
 * Creates a stock location, links it to the partner, and registers the carriers
 * for its country. It does NOT create a store, sales channel, region,
 * publishable key or domain — see the workflow for why that separation is the
 * point (#2061).
 *
 * Ungated beyond "are you a partner", deliberately: holding goods is not a
 * sales decision. The gate question applies to the storefront half and is
 * still open — today `workspace_type` would reject 12 of the 14 partners who
 * already run a store. `metadata.use_type` is no longer a candidate for it:
 * retired as a decider in #2061, it is set on 5 partners of 31 and the column
 * has always won where they disagree.
 *
 * Refuses if the partner already has a warehouse. See
 * `guardSingleWarehouseStep`: a second one makes their goods location ambiguous
 * and stops their production runs completing altogether.
 */
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

  const body = CreatePartnerWarehouseReq.parse(req.body)

  const { result } = await createPartnerWarehouseWorkflow(req.scope).run({
    input: { partner_id: partner.id, ...body },
  })

  return res.status(201).json({
    message: "Warehouse created",
    partner_id: partner.id,
    warehouse: result.location,
  })
}
