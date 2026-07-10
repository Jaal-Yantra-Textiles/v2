import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { reconcileInvestorPayment } from "./lib"

/**
 * POST /webhooks/payu/investor — dedicated PayU dashboard webhook for investor
 * capital-call links (separate from the cart link webhook at
 * /webhooks/payu/link). The investor Payment id is carried in `udf1`.
 *
 * Verify-then-settle: we re-query PayU server-side (see ./lib) rather than trust
 * the inbound hash, then flip Payment → completed and Stake → fully_paid. Always
 * 200 once decided so PayU stops retrying; settlement is idempotent.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  // PayU posts application/x-www-form-urlencoded.
  let payload = (req.body || {}) as Record<string, any>
  if ((!payload || !Object.keys(payload).length) && (req as any).rawBody) {
    payload = Object.fromEntries(new URLSearchParams((req as any).rawBody.toString()))
  }

  const status = String(payload.status || "").toLowerCase()
  const paymentId = payload.udf1
  if (status !== "success" || !paymentId) {
    return res.status(200).json({ received: true })
  }

  try {
    const result = await reconcileInvestorPayment(req.scope, String(paymentId))
    return res
      .status(200)
      .json({ received: true, completed: result.completed, reason: result.reason })
  } catch (e: any) {
    logger.error(`[PayU Investor] settlement failed for payment ${paymentId}: ${e.message}`)
    return res.status(200).json({ received: true, completed: false, error: e.message })
  }
}
