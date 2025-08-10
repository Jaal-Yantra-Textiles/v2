import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listPartnersWorkflow } from "../../../workflows/partners/list-partners"

export const GET = async (
  req: MedusaRequest & {
    query?: {
      offset?: number
      limit?: number
      name?: string
      handle?: string
      status?: "active" | "inactive" | "pending"
      is_verified?: boolean
    }
  },
  res: MedusaResponse
) => {
  const offset = Number(req.query?.offset ?? 0)
  const limit = Number(req.query?.limit ?? 20)

  const { result } = await listPartnersWorkflow(req.scope).run({
    input: {
      fields: req.queryConfig?.fields || ["*"],
      filters: {
        name: req.query?.name,
        handle: req.query?.handle,
        status: req.query?.status,
        is_verified: req.query?.is_verified,
      },
      offset,
      limit,
    },
  })

  const partners = (result as any)?.data || []
  const metadata = (result as any)?.metadata || {}

  res.status(200).json({
    partners,
    count: metadata?.count ?? partners.length,
    offset,
    limit,
  })
}
