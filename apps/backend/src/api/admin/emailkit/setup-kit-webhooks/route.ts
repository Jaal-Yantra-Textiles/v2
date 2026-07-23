import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { KIT_MODULE } from "../../../../modules/kit"
import type KitService from "../../../../modules/kit/service"

/**
 * POST /admin/emailkit/setup-kit-webhooks
 *
 * One-time helper: registers the Kit webhook rules we consume against our
 * `/webhooks/kit` sink. Each Kit rule gets a distinct `?event=<kind>` target so
 * the sink can tell bounce/complain/unsubscribe apart (Kit does not carry the
 * kind in the payload).
 *
 * NOTE: `subscriber.link_click` is intentionally NOT auto-registered — Kit
 * requires a specific link URL (`initiator_value`) per click webhook, so there
 * is no generic "any click" rule. Click/open engagement is instead pulled from
 * the broadcast stats endpoint (`GET /v4/broadcasts/{id}/stats`). The sink still
 * accepts `?event=click` in case a per-link rule is registered manually.
 *
 * Body: { base_url?: string }  — defaults to BACKEND_URL / the request host.
 */
const EVENTS: { name: string; kind: string }[] = [
  { name: "subscriber.subscriber_bounce", kind: "bounce" },
  { name: "subscriber.subscriber_complain", kind: "complain" },
  { name: "subscriber.subscriber_unsubscribe", kind: "unsubscribe" },
]

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { base_url } = (req.body || {}) as { base_url?: string }

  if (!process.env.KIT_API_KEY) {
    return res.status(400).json({ error: "KIT_API_KEY is not configured" })
  }

  const base =
    base_url ||
    process.env.BACKEND_URL ||
    `${req.protocol}://${req.get("host")}`
  const secret = process.env.KIT_WEBHOOK_SECRET
  const tokenQs = secret ? `token=${encodeURIComponent(secret)}&` : ""

  const kit = req.scope.resolve(KIT_MODULE) as KitService

  const registered: { kind: string; ok: boolean; error?: string }[] = []
  for (const ev of EVENTS) {
    const targetUrl = `${base}/webhooks/kit?${tokenQs}event=${ev.kind}`
    try {
      await kit.registerWebhook(targetUrl, ev.name)
      registered.push({ kind: ev.kind, ok: true })
    } catch (e) {
      registered.push({
        kind: ev.kind,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const allOk = registered.every((r) => r.ok)
  return res.status(allOk ? 200 : 207).json({ base_url: base, registered })
}
