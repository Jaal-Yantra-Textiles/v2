import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getInvoice } from "../../../../modules/btcpay-payment/lib/btcpay-client"
import { invoiceVerdict } from "../../../../modules/btcpay-payment/lib/verdict"

/**
 * GET /store/btcpay/status?cart_id=… — read-only: what BTCPay says about this
 * cart's Bitcoin invoice, so the storefront's waiting page completes the cart
 * ONLY once it is paid. (Completing while pending makes Medusa log an
 * authorization error on every poll.)
 *
 *   { state: "paid" | "pending" | "review" | "failed" | "none", status? }
 *
 * The same `invoiceVerdict` authorizePayment uses; this route decides nothing
 * itself — cart completion still re-fetches and re-checks the invoice.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const cartId = String((req.query as any)?.cart_id || "")
  if (!cartId) return res.status(400).json({ message: "cart_id is required" })

  const server_url = process.env.BTCPAY_SERVER_URL
  const api_key = process.env.BTCPAY_SERVER_KEY
  const ourStore = process.env.BTCPAY_SERVER_ID
  if (!server_url || !api_key || !ourStore) return res.json({ state: "none" })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    filters: { id: cartId },
    fields: ["id", "completed_at", "payment_collection.payment_sessions.*"],
  })
  const cart = carts?.[0] as any
  if (!cart) return res.status(404).json({ message: "cart not found" })
  if (cart.completed_at) return res.json({ state: "paid" })

  const session = (cart.payment_collection?.payment_sessions || []).find((s: any) =>
    String(s?.provider_id || "").startsWith("pp_btcpay")
  )
  const data = (session?.data || {}) as Record<string, any>
  if (!session || !data.invoice_id) return res.json({ state: "none" })

  const store = String(data.btcpay_store_id || "") || ourStore
  try {
    const inv = await getInvoice({ server_url, api_key }, store, String(data.invoice_id))
    const v = invoiceVerdict(inv, {
      sessionId: String(data.session_id || ""),
      amount: Number(data.amount),
      currency: String(data.currency || ""),
      storeId: store,
    })
    return res.json({ state: v.verdict, status: inv.status })
  } catch {
    return res.json({ state: "pending" })
  }
}
