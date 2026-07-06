/**
 * PURE provider→normalized-engagement parsers. Sibling of the suppression
 * parsers, but for the events those DROP: delivery, open, click. Both ESPs post
 * different shapes; both reduce to a flat list of `EngagementItem` the webhook
 * routes feed to `recordEngagement`. No IO here — fully unit-testable.
 */

export type EngagementType = "delivered" | "open" | "click"

export type EngagementItem = {
  email: string
  type: EngagementType
  event_id: string | null
  event_at: string | null
  message_id: string | null
}

/**
 * Mailjet Event API. Single event object OR an array. We care about:
 *   sent  → delivered (Mailjet has no separate "delivered"; `sent` = accepted by
 *           the remote MX, which is our per-recipient reached signal)
 *   open  → open
 *   click → click
 * Everything else (bounce/spam/unsub/…) is handled by the suppression parser.
 * The idempotency key is per message + type, so N opens of ONE message collapse
 * to a single "they opened this campaign" — the unit we actually want to count.
 */
export function parseMailjetEngagement(body: any): EngagementItem[] {
  const events = Array.isArray(body) ? body : body ? [body] : []
  const out: EngagementItem[] = []
  for (const e of events) {
    if (!e || typeof e !== "object") continue
    const email = String(e.email || "").trim().toLowerCase()
    if (!email) continue
    const raw = String(e.event || "").toLowerCase()
    let type: EngagementType | null = null
    if (raw === "sent") type = "delivered"
    else if (raw === "open") type = "open"
    else if (raw === "click") type = "click"
    if (!type) continue
    const mid = e.MessageID ?? e.MessageGUID ?? e.mid ?? ""
    const message_id = mid ? String(mid) : null
    const event_id = message_id ? `mje:${type}:${message_id}` : null
    const at =
      typeof e.time === "number" ? new Date(e.time * 1000).toISOString() : null
    out.push({ email, type, event_id, event_at: at, message_id })
  }
  return out
}

/**
 * Resend webhook event. Single object: { type, created_at, data:{ email_id, to[] } }.
 * We care about email.delivered / email.opened / email.clicked. (email.sent is
 * pre-delivery, so it is NOT counted as a delivery to keep the denominator honest.)
 * Docs: https://resend.com/docs/dashboard/webhooks/event-types
 */
export function parseResendEngagement(body: any): EngagementItem[] {
  if (!body || typeof body !== "object") return []
  const t = String(body.type || "").toLowerCase()
  let type: EngagementType | null = null
  if (t === "email.delivered") type = "delivered"
  else if (t === "email.opened") type = "open"
  else if (t === "email.clicked") type = "click"
  if (!type) return []

  const data = body.data || {}
  const recipients: string[] = Array.isArray(data.to)
    ? data.to
    : data.to
    ? [data.to]
    : []
  const emails = recipients
    .map((r) => String(r || "").trim().toLowerCase())
    .filter(Boolean)
  if (!emails.length) return []

  const at = body.created_at ? new Date(body.created_at).toISOString() : null
  const mid = data.email_id || body.id || ""
  const message_id = mid ? String(mid) : null
  return emails.map((email) => ({
    email,
    type: type as EngagementType,
    event_id: message_id ? `rse:${type}:${message_id}:${email}` : null,
    event_at: at,
    message_id,
  }))
}
