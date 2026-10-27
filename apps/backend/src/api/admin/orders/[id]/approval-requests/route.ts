import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { requestOrderApproval } from "../../../../../lib/order-approval/order-approval"
import { ORDER_APPROVAL_MODULE } from "../../../../../modules/order-approval"

/**
 * #2463 — ask the customer to approve the finished goods.
 *
 * POST { photo_urls?, note? } emails the customer a no-login approve/reject
 * link. Photos default to those attached to the order's production runs. A new
 * request supersedes any still-open one. GET lists the order's requests.
 */
const bodySchema = z.object({
  photo_urls: z.array(z.string().url()).optional(),
  note: z.string().max(2000).optional(),
})

const statusFor = (type: string | undefined) =>
  type === MedusaError.Types.NOT_FOUND ? 404 : type === MedusaError.Types.INVALID_DATA ? 400 : 409

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = bodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", details: parsed.error.issues })
  }
  try {
    const approval = await requestOrderApproval(req.scope, {
      order_id: req.params.id,
      photo_urls: parsed.data.photo_urls,
      note: parsed.data.note,
      sent_by: (req as any).auth_context?.actor_id ?? null,
    })
    return res.status(200).json({ order_approval: approval })
  } catch (e: any) {
    if (e instanceof MedusaError) {
      return res.status(statusFor(e.type)).json({ message: e.message })
    }
    throw e
  }
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const rows = await req.scope.resolve<any>(ORDER_APPROVAL_MODULE).listForOrder(req.params.id)
  // Never the token hash.
  const order_approvals = rows.map(({ token_hash, ...rest }: any) => rest)
  return res.json({ order_approvals, count: order_approvals.length })
}
