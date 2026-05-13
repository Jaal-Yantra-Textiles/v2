import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import crypto from "crypto"
import { PARTNER_PLAN_MODULE } from "../../../../../modules/partner-plan"
import PartnerPlanService from "../../../../../modules/partner-plan/service"
import { SubscriptionPaymentStatus } from "../../../../../modules/partner-plan/types"
import { createPartnerSubscriptionWorkflow } from "../../../../../workflows/partner-subscription/create-subscription"

/**
 * POST /partners/subscription/payu/complete
 *
 * PayU surl/furl callback. Receives payment result, verifies hash,
 * activates the subscription on success.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.body as Record<string, any>

  const status = (body.status as string) || ""
  const txnid = (body.txnid as string) || ""
  const mihpayid = (body.mihpayid as string) || ""
  const receivedHash = (body.hash as string) || ""
  const amount = (body.amount as string) || ""
  const productinfo = (body.productinfo as string) || ""
  const firstname = (body.firstname as string) || ""
  const email = (body.email as string) || ""
  const paymentId = (body.udf1 as string) || ""
  const planId = (body.udf2 as string) || ""
  const partnerId = (body.udf3 as string) || ""
  const udf4 = (body.udf4 as string) || ""
  const udf5 = (body.udf5 as string) || ""

  const partnerUiUrl = process.env.PARTNER_UI_URL || "https://partner.jaalyantra.com"
  const payuKey = process.env.PAYU_MERCHANT_KEY || ""
  const payuSalt = process.env.PAYU_MERCHANT_SALT || ""

  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  // PayU reverse hash:
  //   SALT|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
  // udf6..udf10 are empty in our flow → 6 pipes (5 empty fields) between status and udf5.
  const reverseHashString = `${payuSalt}|${status}||||||${udf5}|${udf4}|${partnerId}|${planId}|${paymentId}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${payuKey}`
  const expectedHash = crypto.createHash("sha512").update(reverseHashString).digest("hex")

  const isValidHash = !!receivedHash && receivedHash === expectedHash
  const isSuccess = status.toLowerCase() === "success"

  if (isSuccess && isValidHash) {
    try {
      // Update payment record
      if (paymentId) {
        await service.updateSubscriptionPayments({
          id: paymentId,
          status: SubscriptionPaymentStatus.COMPLETED,
          provider_reference_id: mihpayid || txnid,
          paid_at: new Date(),
          provider_data: {
            ...body,
            hash_verified: true,
          },
        })
      }

      // Activate subscription, then link the new subscription_id back
      // onto the pending payment row so the FK reflects reality.
      if (partnerId && planId) {
        const { result } = await createPartnerSubscriptionWorkflow(req.scope).run({
          input: {
            partner_id: partnerId,
            plan_id: planId,
            payment_provider: "payu",
          },
        })
        const newSubscriptionId = (result as any)?.subscription?.id
        if (paymentId && newSubscriptionId) {
          await service.updateSubscriptionPayments({
            id: paymentId,
            subscription_id: newSubscriptionId,
          } as any)
        }
      }

      return res.redirect(302, `${partnerUiUrl}/settings/plan?payment=success`)
    } catch (e: any) {
      console.error("[PayU Subscription] Error activating:", e)
      return res.redirect(302, `${partnerUiUrl}/settings/plan?payment=error&message=${encodeURIComponent(e.message)}`)
    }
  }

  // Anything that isn't (success + valid hash) is a failure path.
  // A "success" status with a hash mismatch is treated as failure: never
  // activate a subscription without verified payment confirmation.
  try {
    if (paymentId) {
      const failure_reason = isSuccess && !isValidHash
        ? "PayU hash verification failed"
        : (body.error_Message || body.unmappedstatus || status || "Payment failed")
      await service.updateSubscriptionPayments({
        id: paymentId,
        status: SubscriptionPaymentStatus.FAILED,
        failed_at: new Date(),
        failure_reason,
        provider_data: { ...body, hash_verified: isValidHash },
      })
    }
  } catch (e) {
    console.error("[PayU Subscription] Error recording failure:", e)
  }

  if (isSuccess && !isValidHash) {
    console.warn(`[PayU Subscription] Hash mismatch: txnid=${txnid}`)
    return res.redirect(
      302,
      `${partnerUiUrl}/settings/plan?payment=error&message=${encodeURIComponent("Hash verification failed")}`
    )
  }

  return res.redirect(302, `${partnerUiUrl}/settings/plan?payment=failed`)
}
