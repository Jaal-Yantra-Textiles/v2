import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { getApprovalForToken } from "../../../../lib/order-approval/order-approval"

/**
 * #2463 — the customer's no-login approval page reads this. 404 on an unknown
 * token; a decided, expired or superseded request still returns, so the page
 * can say what happened instead of looking broken.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const view = await getApprovalForToken(req.scope, String(req.params.token || ""))
  if (!view) {
    return res.status(404).json({ message: "This approval link is not valid." })
  }
  return res.json({ order_approval: view })
}
