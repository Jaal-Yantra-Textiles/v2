import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PARTNER_QUOTE_MODULE } from "../../../modules/partner-quote"
import { buildBriefView } from "../../../modules/partner-quote/lib/brief-view"
import { createQuoteBriefWorkflow } from "../../../workflows/partner-quote/create-quote-brief"
import type { AdminCreateQuoteBriefReqType } from "./validators"

/**
 * Quote briefs (#2608 S1). A brief is created as a DRAFT with no link; open it
 * (POST /:id/open) to mint the buyer's link. Creating one sends nothing.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as AdminCreateQuoteBriefReqType
  const { result } = await createQuoteBriefWorkflow(req.scope).run({
    input: { ...body, created_by: (req as any).auth_context?.actor_id ?? null },
  })
  const brief = await buildBriefView(req.scope, result.id, { audience: "admin" })
  res.status(201).json({ brief })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const filters: Record<string, unknown> = {}
  if (typeof req.query.partner_id === "string") filters.partner_id = req.query.partner_id
  if (typeof req.query.status === "string") filters.status = req.query.status
  const take = Math.min(Number(req.query.limit) || 20, 100)
  const skip = Math.max(Number(req.query.offset) || 0, 0)
  const [rows, count] = await service.listAndCountPartnerQuoteBriefs(filters, {
    take,
    skip,
    order: { created_at: "DESC" },
    select: [
      "id", "title", "status", "partner_id", "store_id", "customer_id", "buyer_email",
      "recipient_name", "destination_country_code", "sample_quantity", "submitted_at",
      "view_count", "last_viewed_at", "quote_id", "created_at",
    ],
  })
  res.json({ briefs: rows, count, limit: take, offset: skip })
}
