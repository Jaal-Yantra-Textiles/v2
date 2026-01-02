import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { listFormResponsesWorkflow } from "../../../../../workflows/forms/list-form-responses"
import { AdminListFormResponsesQuery } from "../../validators"

export const GET = async (
  req: MedusaRequest<AdminListFormResponsesQuery>,
  res: MedusaResponse
) => {
  const queryParams = req.validatedQuery || {}

  const filters: Record<string, any> = {
    form_id: req.params.id,
  }

  if (queryParams.status) {
    filters.status = queryParams.status
  }

  if (queryParams.email) {
    filters.email = { $ilike: `%${queryParams.email}%` }
  }

  if (queryParams.q) {
    filters.email = { $ilike: `%${queryParams.q}%` }
  }

  const { result } = await listFormResponsesWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        skip: queryParams.offset || 0,
        take: queryParams.limit || 20,
      },
    },
  })

  res.status(200).json({
    responses: result[0],
    count: result[1],
    offset: queryParams.offset || 0,
    limit: queryParams.limit || 20,
  })
}
