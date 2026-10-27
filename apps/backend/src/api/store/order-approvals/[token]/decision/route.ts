import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  decideOrderApproval,
  getApprovalForToken,
} from "../../../../../lib/order-approval/order-approval"

/**
 * #2463 — the customer approves or rejects. Body { decision, reason? }; a
 * reason is required to reject. Answerable once.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { decision?: unknown; reason?: unknown }
  const token = String(req.params.token || "")
  try {
    await decideOrderApproval(req.scope, {
      token,
      decision: body.decision,
      reason: body.reason,
    })
    return res.json({ order_approval: await getApprovalForToken(req.scope, token) })
  } catch (e: any) {
    if (e instanceof MedusaError) {
      const status =
        e.type === MedusaError.Types.NOT_FOUND
          ? 404
          : e.type === MedusaError.Types.INVALID_DATA
            ? 400
            : 409
      return res.status(status).json({ message: e.message })
    }
    throw e
  }
}
