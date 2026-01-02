import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, response_id } = req.params as any

  const query = req.scope.resolve(
    ContainerRegistrationKeys.QUERY
  ) as Omit<RemoteQueryFunction, symbol>

  const { data } = await query.graph({
    entity: "form_response",
    filters: {
      id: response_id,
      form_id: id,
    },
    fields: ["*"],
    pagination: {
      take: 1,
    },
  })

  const response = (data || [])[0]

  if (!response) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Response ${response_id} not found for form ${id}`
    )
  }

  res.status(200).json({ response })
}
