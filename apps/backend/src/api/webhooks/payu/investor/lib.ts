import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../modules/investor"
import type InvestorService from "../../../../modules/investor/service"
import {
  isLinkPaid,
  oneapiHosts,
  oneapiLinkTxnsUrl,
} from "../../../store/payu/payment-link/lib"

export type InvestorReconcileResult = {
  completed: boolean
  reason: string
}

/**
 * Reconcile an investor capital-call Payment from a settled PayU link.
 *
 * The authoritative gate is an independent server-side re-query of PayU's OneAPI
 * `/payment-links/{invoice}/txns` (same approach as the store link webhook — the
 * inbound Salt-v2 hash can't be reproduced locally, and re-query is replay-proof).
 * On confirmed payment: Payment → completed and the linked Stake → fully_paid.
 * Idempotent — a Payment already `completed` short-circuits to success.
 */
export async function reconcileInvestorPayment(
  container: any,
  paymentId: string
): Promise<InvestorReconcileResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: InvestorService = container.resolve(INVESTOR_MODULE)

  const payments: any[] = await service.listPayments({ id: paymentId } as any)
  const payment = payments?.[0]
  if (!payment) {
    return { completed: false, reason: "payment_not_found" }
  }
  if (payment.status === "completed") {
    return { completed: true, reason: "already_completed" }
  }

  const invoice = payment.metadata?.payu_invoice_number
  const clientId = process.env.PAYU_CLIENT_ID
  const clientSecret = process.env.PAYU_CLIENT_SECRET
  const merchantId = process.env.PAYU_MERCHANT_ID

  let paid = false
  if (clientId && clientSecret && merchantId && invoice) {
    try {
      const hosts = oneapiHosts(process.env.PAYU_ONEAPI_MODE)
      const tr = await fetch(hosts.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: "read_payment_links",
        }).toString(),
      })
      const tj: any = await tr.json().catch(() => ({}))
      if (tj.access_token) {
        const vr = await fetch(
          oneapiLinkTxnsUrl(process.env.PAYU_ONEAPI_MODE, String(invoice)),
          {
            headers: {
              Authorization: `Bearer ${tj.access_token}`,
              merchantId: String(merchantId),
            },
          }
        )
        const vj: any = await vr.json().catch(() => ({}))
        const minAmount = Number(payment.amount)
        paid = isLinkPaid(vj, isNaN(minAmount) ? undefined : Math.round(minAmount)).paid
      }
    } catch (e: any) {
      logger.warn(`[PayU Investor] re-verify error for invoice ${invoice}: ${e.message}`)
    }
  }

  if (!paid) {
    return { completed: false, reason: "not_verified" }
  }

  await service.updatePayments({
    id: payment.id,
    status: "completed",
    paid_date: new Date(),
  } as any)
  if (payment.stake_id) {
    await service.updateStakes({ id: payment.stake_id, status: "fully_paid" } as any)
  }

  return { completed: true, reason: "verified" }
}
