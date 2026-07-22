import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { KIT_MODULE } from "../../../../modules/kit"
import type KitService from "../../../../modules/kit/service"

/**
 * POST /admin/emailkit/setup-kit-webhooks
 *
 * One-time helper: registers the Kit webhook rules we consume against our
 * `/webhooks/kit` sink. Each Kit rule gets a distinct `?event=<kind>` target so
 * the sink can tell bounce/complain/unsubscribe/click apart (Kit does not carry
 * the kind in the payload).
 *
 * Body: { base_url?: string }  — defaults to BACKEND_URL / the request host.
 */
const EVENTS: { name: string; kind: string }[] = [
  { name: "subscriber.subscriber_bounce", kind: "bounce" },
  { name: "subscriber.subscriber_complain", kind: "complain" },
  { name: "subscriber.subscriber_unsubscribe", kind: "unsubscribe" },
  { name: "subscriber.link_click", kind: "click" },
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
