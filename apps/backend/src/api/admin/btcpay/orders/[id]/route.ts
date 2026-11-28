import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getInvoice, listPullPaymentPayouts } from "../../../../../modules/btcpay-payment/lib/btcpay-client"

/**
 * GET /admin/btcpay/orders/:id — the order's Bitcoin payment as BTCPay sees it,
 * for the order page widget: the invoice (status, link) and every refund with
 * the buyer's claim link and where the payout stands.
 *
 * Read-only. Refunds themselves go through Medusa's own "Refund" on the
 * payment (refundPaymentWorkflow → provider.refundPayment → BTCPay pull
 * payment), so the order's totals and refund records stay Medusa's.
 *
 * A BTCPay refund moves nothing by itself: the buyer opens the claim link and
 * gives an address (→ payout AwaitingApproval), then the store approves and
 * pays it from the BTCPay wallet.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const server_url = (process.env.BTCPAY_SERVER_URL || "").replace(/\/+$/, "")
  const api_key = process.env.BTCPAY_SERVER_KEY
  const ourStore = process.env.BTCPAY_SERVER_ID
  const cfg = { server_url, api_key: api_key || "" }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: req.params.id },
    fields: [
      "id",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.data",
      "payment_collections.payments.refunds.id",
      "payment_collections.payments.refunds.amount",
    ],
  })
  const order = orders?.[0] as any
  if (!order) return res.status(404).json({ message: "order not found" })

  const payments = (order.payment_collections || [])
    .flatMap((pc: any) => pc?.payments || [])
    .filter((p: any) => String(p?.provider_id || "").startsWith("pp_btcpay"))

  if (!payments.length) return res.json({ btcpay: false, payments: [] })
  const configured = !!(server_url && api_key && ourStore)

  const out = await Promise.all(
    payments.map(async (p: any) => {
      const d = (p.data || {}) as Record<string, any>
      const store = String(d.btcpay_store_id || "") || String(ourStore || "")
      const invoice: Record<string, any> = {
        id: d.invoice_id,
        store_id: store,
        partner_id: d.partner_id ?? null,
        link: server_url && d.invoice_id ? `${server_url}/invoices/${d.invoice_id}` : null,
      }
      if (configured && d.invoice_id) {
        try {
          const inv = await getInvoice(cfg, store, String(d.invoice_id))
          invoice.status = inv.status
          invoice.additional_status = inv.additionalStatus
          invoice.amount = inv.amount
          invoice.currency = inv.currency
        } catch (e: any) {
          invoice.error = e.message
        }
      }

      const entries: any[] = Array.isArray(d.btcpay_refunds)
        ? d.btcpay_refunds
        : d.refund_pull_payment_id
          ? [{ pull_payment_id: d.refund_pull_payment_id, link: d.refund_link, amount: d.refund_amount, currency: d.currency }]
          : []
      const refunds = await Promise.all(
        entries.map(async (r) => {
          let payouts: { id: string; state: string; btc?: string | null; destination?: string }[] | null = null
          let error: string | undefined
          if (configured && r.pull_payment_id) {
            try {
              payouts = (await listPullPaymentPayouts(cfg, store, String(r.pull_payment_id))).map((x) => ({
                id: x.id,
                state: x.state,
                btc: x.payoutAmount ?? null,
                destination: x.destination,
              }))
            } catch (e: any) {
              error = e.message
            }
          }
          return { ...r, payouts, error }
        })
      )

      return {
        payment_id: p.id,
        amount: p.amount,
        currency_code: p.currency_code,
        refunded_in_medusa: (p.refunds || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
        invoice,
        refunds,
        btcpay_payouts_url: server_url ? `${server_url}/stores/${store}/payouts` : null,
      }
    })
  )

  res.json({ btcpay: true, configured, payments: out })
}
