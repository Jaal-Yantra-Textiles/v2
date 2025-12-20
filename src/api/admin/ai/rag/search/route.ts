import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  AdminRagSearchQuery,
  AdminRagSearchQueryType,
} from "./validators"
import { queryAdminEndpointsVectorOnly } from "../../../../../mastra/rag/adminCatalog"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = AdminRagSearchQuery.safeParse(
    ((req as any).validatedQuery || req.query || {}) as AdminRagSearchQueryType
  )

  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join(", ")
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      message || "Invalid query"
    )
  }

  const { q, topK, method } = parsed.data

  const out = await queryAdminEndpointsVectorOnly(q, {
    topK: typeof topK === "number" ? topK : 10,
    method: method ? String(method).toUpperCase() : undefined,
  })

  return res.json(out)
}
