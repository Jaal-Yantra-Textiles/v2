import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import listSinglePartnerWorkflow from "../../../../workflows/partners/list-single-partner"
import updatePartnerWorkflow from "../../../../workflows/partners/update-partner"
import { ListPartnersQuerySchema } from "../validators"

// Get a single partner by id
export const GET = async (
  req: MedusaRequest<ListPartnersQuerySchema>,
  res: MedusaResponse
) => {
  const id = req.params.id
  const vq = (req as any).validatedQuery as ListPartnersQuerySchema | undefined
  const fields = (() => {
    const f = vq?.fields as unknown as string | string[] | undefined
    let arr: string[] | undefined
    if (typeof f === "string") {
      arr = f.split(",").map((s) => s.trim()).filter(Boolean)
    } else if (Array.isArray(f)) {
      arr = f
    }
    // Always include defaults
    const defaults = ["*", "admins.*"]
    const finalSet = new Set([...(arr || []), ...defaults])
    const final = Array.from(finalSet)
    return final.length ? final : undefined
  })()
  const { result } = await listSinglePartnerWorkflow(req.scope).run({
    input: {
      id,
      fields,
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
    admin_id?: string
    admin_password?: string
  }>,
  res: MedusaResponse
) => {
  const id = req.params.id

  const body = (req.validatedBody || (req.body as any) || {}) as any
  const { admin_id, admin_password, ...partnerData } = body

  const { result, errors } = await updatePartnerWorkflow(req.scope).run({
    input: {
      id,
      admin_id,
      admin_password,
      data: partnerData,
    },
  })

  if (errors.length > 0) {
    return res.status(400).json({ errors })
  }

  res.status(200).json({ partner: result })
}
