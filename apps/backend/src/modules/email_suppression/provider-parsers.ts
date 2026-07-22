import type { SuppressReason } from "./suppress-core"

/**
 * PURE provider→normalized-event parsers. Each ESP posts a different shape; both
 * reduce to a flat list of suppression items the webhook routes feed to
 * `suppressEmail`. No IO here — fully unit-testable.
 */

export type SuppressItem = {
  email: string
  reason: SuppressReason
  event_id: string | null
  event_at: string | null
}

/**
 * Mailjet Event API. Payload is a single event object OR an array of them (when
 * "group events" is enabled). Relevant events:
 *   bounce (hard_bounce flag) · blocked · spam · unsub
 * Everything else (sent/open/click/…) is ignored.
 * Docs: https://dev.mailjet.com/email/guides/webhooks/
 */
export function parseMailjetEvents(body: any): SuppressItem[] {
  const events = Array.isArray(body) ? body : body ? [body] : []
  const out: SuppressItem[] = []
  for (const e of events) {
    if (!e || typeof e !== "object") continue
    const email = String(e.email || "").trim().toLowerCase()
    if (!email) continue
    const type = String(e.event || "").toLowerCase()
    let reason: SuppressReason | null = null
    if (type === "bounce") {
      // hard_bounce may arrive as boolean true or string "true".
      const hard = e.hard_bounce === true || e.hard_bounce === "true"
      reason = hard ? "hard_bounce" : "soft_bounce"
    } else if (type === "blocked") {
      reason = "hard_bounce"
    } else if (type === "spam") {
      reason = "spam_complaint"
    } else if (type === "unsub") {
      reason = "unsubscribe"
    }
    if (!reason) continue
    // MessageID/MessageGUID identify the send; combine with event type so a
    // bounce and a later spam on the same message are distinct rows.
    const mid = e.MessageID ?? e.MessageGUID ?? e.mid ?? ""
    const event_id = mid ? `mj:${type}:${mid}` : null
    const at =
      typeof e.time === "number" ? new Date(e.time * 1000).toISOString() : null
    out.push({ email, reason, event_id, event_at: at })
  }
  return out
}

/**
 * Resend webhook event. Single object: { type, created_at, data:{ email_id, to[],
 * bounce?:{ type } } }. Relevant types: email.bounced, email.complained.
 * Docs: https://resend.com/docs/dashboard/webhooks/event-types
 */
export function parseResendEvent(body: any): SuppressItem[] {
  if (!body || typeof body !== "object") return []
  const type = String(body.type || "").toLowerCase()
  const data = body.data || {}
  const recipients: string[] = Array.isArray(data.to)
    ? data.to
    : data.to
    ? [data.to]
    : []
  const emails = recipients.map((r) => String(r || "").trim().toLowerCase()).filter(Boolean)
  if (!emails.length) return []

  let reason: SuppressReason | null = null
  if (type === "email.bounced") {
    // bounce.type: "hard"/"soft" or Resend's "Permanent"/"Transient".
    const bt = String(data.bounce?.type || data.bounce_type || "").toLowerCase()
    reason = bt.startsWith("soft") || bt.startsWith("transient") ? "soft_bounce" : "hard_bounce"
  } else if (type === "email.complained") {
    reason = "spam_complaint"
  }
  if (!reason) return []

  const at = body.created_at ? new Date(body.created_at).toISOString() : null
  const baseId = data.email_id || body.id || ""
  return emails.map((email) => ({
    email,
    reason: reason as SuppressReason,
    // email_id is per-message; pair with recipient + type for a stable key.
    event_id: baseId ? `rs:${type}:${baseId}:${email}` : null,
    event_at: at,
  }))
}

/**
 * Kit (kit.com) webhook. Kit posts one subscriber object per rule and does NOT
 * carry the event kind in the payload, so we register each rule against a
 * distinct `?event=<kind>` target URL and pass that kind in here. Relevant
 * kinds: bounce · complain · unsubscribe (click is engagement, not suppression).
 * Docs: https://developers.kit.com/api-reference (webhooks)
 */
export function parseKitSuppression(body: any, kind: string): SuppressItem[] {
  const sub = (body && (body.subscriber || body)) || {}
  const email = String(sub.email_address || sub.email || "").trim().toLowerCase()
  if (!email) return []

  let reason: SuppressReason | null = null
  switch (String(kind || "").toLowerCase()) {
    case "bounce":
      reason = "hard_bounce"
      break
    case "complain":
    case "complaint":
      reason = "spam_complaint"
      break
    case "unsubscribe":
    case "unsub":
      reason = "unsubscribe"
      break
  }
  if (!reason) return []

  const subId = sub.id ?? body?.id ?? ""
  const event_id = subId ? `kit:${String(kind).toLowerCase()}:${subId}` : null
  const rawAt = body?.created_at || sub.updated_at || sub.created_at || null
  const at = rawAt ? new Date(rawAt).toISOString() : null
  return [{ email, reason, event_id, event_at: at }]
}
