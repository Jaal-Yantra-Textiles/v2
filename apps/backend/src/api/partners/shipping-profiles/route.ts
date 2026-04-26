import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createShippingProfilesWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../helpers"
import { z } from "@medusajs/framework/zod"

const PartnerCreateShippingProfileReq = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
})

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
  const { data: profiles } = await query.graph({
    entity: "shipping_profiles",
    fields: ["*"],
  })

  res.json({
    shipping_profiles: profiles || [],
    count: profiles?.length || 0,
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

  const body = PartnerCreateShippingProfileReq.parse(req.body)

  const { result } = await createShippingProfilesWorkflow(req.scope).run({
    input: {
      data: [body],
    },
  })

  res.status(201).json({ shipping_profile: result[0] })
}
