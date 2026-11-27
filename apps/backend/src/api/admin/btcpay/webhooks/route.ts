import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createWebhook, listWebhooks } from "../../../../modules/btcpay-payment/lib/btcpay-client"
import { storeWebhookSecret } from "../../../../modules/btcpay-payment/lib/verdict"
import { BTCPAY_CONFIG_PROVIDER_ID } from "../../../../modules/btcpay-payment/lib/resolve-partner-store"

/**
 * GET  /admin/btcpay/webhooks — which BTCPay stores (ours + every active
 *      partner config) already deliver to our webhook URL.
 * POST /admin/btcpay/webhooks — create the missing ones, each with its
 *      DERIVED secret (no secret is stored; the provider re-derives it).
 *
 * Webhook URL: {MEDUSA_BACKEND_URL}/hooks/payment/btcpay_btcpay (Medusa core).
 * Needs btcpay.store.webhooks.canmodifywebhooks on the key.
 */
const env = () => {
  const server_url = process.env.BTCPAY_SERVER_URL
  const api_key = process.env.BTCPAY_SERVER_KEY
  const store_id = process.env.BTCPAY_SERVER_ID
  const secret = process.env.BTCPAY_WEBHOOK_SECRET
  const backend = (process.env.MEDUSA_BACKEND_URL || "").replace(/\/+$/, "")
  if (!server_url || !api_key || !store_id || !secret || !backend) return null
  return { cfg: { server_url, api_key }, store_id, secret, url: `${backend}/hooks/payment/btcpay_btcpay` }
}

async function storesToWire(req: MedusaRequest, ourStore: string) {
  const configs = await (req.scope.resolve("partner_payment_config") as any)
    .listPartnerPaymentConfigs({ provider_id: BTCPAY_CONFIG_PROVIDER_ID, is_active: true })
    .catch(() => [])
  const stores = new Map<string, string>([[ourStore, "ours"]])
  for (const c of configs || []) {
    const sid = String(c?.credentials?.store_id || "").trim()
    if (sid && !stores.has(sid)) stores.set(sid, `partner ${c.partner_id}`)
  }
  return stores
}

async function report(req: MedusaRequest, create: boolean) {
  const e = env()
  if (!e) {
    return { configured: false, error: "Set BTCPAY_SERVER_URL, BTCPAY_SERVER_KEY, BTCPAY_SERVER_ID, BTCPAY_WEBHOOK_SECRET and MEDUSA_BACKEND_URL" }
  }
  const out: any[] = []
  for (const [storeId, owner] of await storesToWire(req, e.store_id)) {
    try {
      const hooks = await listWebhooks(e.cfg, storeId)
      const existing = hooks.find((h) => h.url === e.url)
      if (existing) {
        out.push({ store_id: storeId, owner, webhook_id: existing.id, status: "present" })
      } else if (create) {
        const made = await createWebhook(e.cfg, storeId, e.url, storeWebhookSecret(e.secret, storeId))
        out.push({ store_id: storeId, owner, webhook_id: made.id, status: "created" })
      } else {
        out.push({ store_id: storeId, owner, status: "missing" })
      }
    } catch (err: any) {
      out.push({ store_id: storeId, owner, status: "error", error: err.message })
    }
  }
  return { configured: true, webhook_url: e.url, stores: out }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json(await report(req, false))
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json(await report(req, true))
}
