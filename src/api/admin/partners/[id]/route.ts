import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import listSinglePartnerWorkflow from "../../../../workflows/partners/list-single-partner"
import updatePartnerWorkflow from "../../../../workflows/partners/update-partner"

// Get a single partner by id
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const id = req.params.id
  const { result } = await listSinglePartnerWorkflow(req.scope).run({
    input: {
      id,
      fields: req.queryConfig?.fields || ["*", "admins.*"],
    },
  })

  res.status(200).json({ partner: result })
}

// Update a partner by id
export const PUT = async (
  req: MedusaRequest<{
    name?: string
    handle?: string
    logo?: string | null
    status?: "active" | "inactive" | "pending"
    is_verified?: boolean
    metadata?: Record<string, any> | null
  }>,
  res: MedusaResponse
) => {
  const id = req.params.id

  const { result, errors } = await updatePartnerWorkflow(req.scope).run({
    input: {
      id,
      data: req.validatedBody || (req.body as any) || {},
    },
  })

  if (errors.length > 0) {
    return res.status(400).json({ errors })
  }

  res.status(200).json({ partner: result })
}
