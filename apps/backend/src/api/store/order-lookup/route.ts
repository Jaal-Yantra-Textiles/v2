import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * POST /store/order-lookup  { order_number, email } → { order_id }
 *
 * Lets anyone with their order number and the email they ordered with reach
 * the public order page (/{cc}/order/{order_id}) — no account needed. The
 * order id is a long random id, so the page itself is the capability; this
 * route only hands it out to someone who knows BOTH the number and the email.
 *
 * - Scoped to the storefront's sales channels (publishable key), so one
 *   partner's storefront can't look up another's orders.
 * - A miss and a wrong email return the same 404, so the route can't be used
 *   to test which order numbers or emails exist.
 * - A small per-IP limit slows guessing (Cloudflare's rate limit sits in front).
 */
const WINDOW_MS = 10 * 60 * 1000
const MAX_TRIES = 10
const tries = new Map<string, { n: number; since: number }>()

export function lookupAllowed(ip: string, now = Date.now()): boolean {
  const t = tries.get(ip)
  if (!t || now - t.since > WINDOW_MS) {
    tries.set(ip, { n: 1, since: now })
    if (tries.size > 5000) {
      for (const [k, v] of tries) if (now - v.since > WINDOW_MS) tries.delete(k)
    }
    return true
  }
  t.n += 1
  return t.n <= MAX_TRIES
}

/** "#331", "331", " 331 " → 331; anything else → null. */
export function parseOrderNumber(raw: unknown): number | null {
  const m = String(raw ?? "").trim().replace(/^#/, "").match(/^\d{1,10}$/)
  return m ? Number(m[0]) : null
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const ip = String(req.headers["cf-connecting-ip"] || req.ip || "unknown")
  if (!lookupAllowed(ip)) {
    return res.status(429).json({ message: "Too many tries. Please wait a few minutes and try again." })
  }

  const body = (req.body || {}) as Record<string, unknown>
  const displayId = parseOrderNumber(body.order_number)
  const email = String(body.email ?? "").trim().toLowerCase()
  const notFound = () =>
    res.status(404).json({ message: "We couldn't find an order with that number and email." })
  if (!displayId || !email || !email.includes("@")) return notFound()

  const channels: string[] = (req as any).publishable_key_context?.sales_channel_ids ?? []
  if (!channels.length) return notFound()

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    filters: { display_id: displayId, sales_channel_id: channels, is_draft_order: false } as any,
    fields: ["id", "email", "sales_channel_id"],
  })
  const order = (data || []).find((o: any) => String(o?.email || "").trim().toLowerCase() === email)
  if (!order) return notFound()

  res.json({ order_id: (order as any).id })
}
