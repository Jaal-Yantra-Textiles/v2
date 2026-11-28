import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"

import { getInvoice } from "../modules/btcpay-payment/lib/btcpay-client"
import { invoiceVerdict } from "../modules/btcpay-payment/lib/verdict"

/**
 * Bitcoin safety net: place the order for any checkout whose BTCPay invoice is
 * paid but whose cart is still open.
 *
 * Normally BTCPay's webhook places the order, or the buyer's waiting page
 * does. Both can miss: the page is closed, the webhook is dropped (Cloudflare,
 * a deploy, BTCPay giving up on redelivery). Bitcoin confirms 10–60 min after
 * payment, so "the buyer paid and walked away" is the common case, not an
 * edge one. This sweep makes the order land anyway, a few minutes late.
 *
 * It decides nothing on its own: it only asks BTCPay (same `invoiceVerdict`
 * as everything else) and, for a paid invoice, runs Medusa's complete-cart,
 * which re-authorizes through the provider — i.e. re-fetches and re-checks the
 * invoice again. A cart the webhook completed meanwhile is skipped by the
 * query, or returns its existing order.
 *
 * Window: sessions from the last BITCOIN_SWEEP_DAYS days (default 3). An
 * invoice expires after 15 min unpaid, but one paid in time can take hours to
 * confirm on a slow chain.
 */
const MAX_BATCH = Number(process.env.BITCOIN_SWEEP_MAX_BATCH || 50)
const DAYS = Number(process.env.BITCOIN_SWEEP_DAYS || 3)

export type OpenBitcoinSession = { session_id: string; cart_id: string; data: Record<string, any> }

/** Pure: should this open session's cart be completed, given BTCPay's invoice? */
export function sweepDecision(
  inv: Parameters<typeof invoiceVerdict>[0],
  s: OpenBitcoinSession,
  ourStore: string
): { complete: boolean; verdict: string; reason: string } {
  const store = String(s.data.btcpay_store_id || "") || ourStore
  const v = invoiceVerdict(inv, {
    // The row's own id, not data.session_id: session data is buyer-writable.
    sessionId: s.session_id,
    amount: Number(s.data.amount),
    currency: String(s.data.currency || ""),
    storeId: store,
  })
  return { complete: v.verdict === "paid", verdict: v.verdict, reason: v.reason }
}

export default async function completePaidBitcoinCarts(container: MedusaContainer) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const server_url = process.env.BTCPAY_SERVER_URL
  const api_key = process.env.BTCPAY_SERVER_KEY
  const ourStore = process.env.BTCPAY_SERVER_ID
  if (!server_url || !api_key || !ourStore) return

  const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  let rows: OpenBitcoinSession[] = []
  try {
    const result = await pg.raw(
      `select ps.id as session_id, cpc.cart_id, ps.data
         from payment_session ps
         join cart_payment_collection cpc
           on cpc.payment_collection_id = ps.payment_collection_id and cpc.deleted_at is null
         join cart c on c.id = cpc.cart_id
        where ps.provider_id like 'pp_bitcoin%'
          and ps.deleted_at is null
          and ps.status = 'pending'
          and c.deleted_at is null
          and c.completed_at is null
          and ps.created_at > now() - make_interval(days => ?)
        order by ps.created_at asc
        limit ?`,
      [DAYS, MAX_BATCH]
    )
    rows = result?.rows ?? []
  } catch (e: any) {
    logger.error(`[bitcoin-sweep] query failed: ${e?.message ?? e}`)
    return
  }
  if (!rows.length) return

  let completed = 0
  for (const s of rows) {
    const invoiceId = String(s.data?.invoice_id || "")
    if (!invoiceId) continue
    const store = String(s.data?.btcpay_store_id || "") || ourStore
    let inv
    try {
      inv = await getInvoice({ server_url, api_key }, store, invoiceId)
    } catch (e: any) {
      logger.warn(`[bitcoin-sweep] could not read invoice ${invoiceId}: ${e?.message ?? e}`)
      continue
    }
    const d = sweepDecision(inv, s, ourStore)
    if (!d.complete) {
      if (d.verdict === "review") {
        logger.error(`[bitcoin-sweep] NEEDS REVIEW cart ${s.cart_id} invoice ${invoiceId}: ${d.reason} — not placing the order`)
      }
      continue
    }
    try {
      const { result } = await completeCartWorkflow(container).run({ input: { id: s.cart_id } })
      completed += 1
      logger.info(`[bitcoin-sweep] placed order ${(result as any)?.id} for cart ${s.cart_id} (invoice ${invoiceId} ${d.reason})`)
    } catch (e: any) {
      logger.error(`[bitcoin-sweep] invoice ${invoiceId} is paid but cart ${s.cart_id} did not complete: ${e?.message ?? e}`)
    }
  }
  if (completed) logger.info(`[bitcoin-sweep] placed ${completed} order(s) from ${rows.length} open Bitcoin checkout(s)`)
}

export const config = {
  name: "complete-paid-bitcoin-carts",
  schedule: "*/5 * * * *",
}
