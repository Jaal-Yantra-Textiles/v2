import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../helpers"
import { PartnerCreateShippingOptionReq } from "../validators"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  if (!store.default_location_id) {
    return res.json({ shipping_options: [], count: 0, offset: 0, limit: 20 })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get shipping options through the location → fulfillment sets → service zones chain
  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: [
      "fulfillment_sets.service_zones.shipping_options.*",
      "fulfillment_sets.service_zones.shipping_options.prices.*",
      "fulfillment_sets.service_zones.shipping_options.rules.*",
      "fulfillment_sets.service_zones.shipping_options.type.*",
      "fulfillment_sets.service_zones.shipping_options.shipping_profile.*",
    ],
    filters: { id: store.default_location_id },
  })

  const shippingOptions: any[] = []
  const location = locations?.[0]
  if (location?.fulfillment_sets) {
    for (const fs of location.fulfillment_sets) {
      if (fs?.service_zones) {
        for (const sz of fs.service_zones) {
          if (sz?.shipping_options) {
            for (const so of sz.shipping_options) {
              shippingOptions.push({
                ...so,
                service_zone: {
                  id: sz.id,
                  name: sz.name,
                  fulfillment_set: {
                    id: fs.id,
                    name: fs.name,
                    type: fs.type,
                  },
                },
              })
            }
          }
        }
      }
    }
  }

  res.json({
    shipping_options: shippingOptions,
    count: shippingOptions.length,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = PartnerCreateShippingOptionReq.parse(req.body)

  const { result } = await createShippingOptionsWorkflow(req.scope).run({
    input: [body as any],
  })

  res.status(201).json({ shipping_option: result[0] })
}
