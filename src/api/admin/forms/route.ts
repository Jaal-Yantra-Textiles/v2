import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createFormWorkflow } from "../../../workflows/forms/create-form"
import { listFormsWorkflow } from "../../../workflows/forms/list-forms"
import {
  AdminCreateForm,
  AdminListFormsQuery,
} from "./validators"

export const GET = async (
  req: MedusaRequest<AdminListFormsQuery>,
  res: MedusaResponse
) => {
  const queryParams = req.validatedQuery || {}

  const filters: Record<string, any> = {}
  if (queryParams.status) {
    filters.status = queryParams.status
  }
  if (queryParams.website_id) {
    filters.website_id = queryParams.website_id
  }
  if (queryParams.domain) {
    filters.domain = queryParams.domain
  }
  if (queryParams.q) {
    filters.title = { $ilike: `%${queryParams.q}%` }
  }

  const { result } = await listFormsWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        skip: queryParams.offset || 0,
        take: queryParams.limit || 20,
      },
    },
  })

  res.status(200).json({
    forms: result[0],
    count: result[1],
    offset: queryParams.offset || 0,
    limit: queryParams.limit || 20,
  })
}

export const POST = async (
  req: MedusaRequest<AdminCreateForm>,
  res: MedusaResponse
) => {
  const { result } = await createFormWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  res.status(201).json({ form: result })
}
