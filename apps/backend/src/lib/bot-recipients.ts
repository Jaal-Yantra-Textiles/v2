/**
 * Known-bot recipient policy — the ONE place we decide that an address belongs
 * to a crawler rather than a person (#1333, part of #1327).
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * Google's shopping crawler adds items to a cart to verify price and
 * availability. Our cart-recovery flow cannot tell that visit from a customer's,
 * so it emails the crawler. On prod, `johnsmith004@storebotmail.joonix.net` was
 * the ONLY `cart-abandoned` recipient in the last 200 notifications — six sends
 * across four days, every one recorded `success`. Nothing surfaced the waste
 * because a send to a black hole looks exactly like a send to a customer.
 *
 * ── Suppress, do NOT block ────────────────────────────────────────────────────
 *
 * The crawler's visits are legitimate and we want them: blocking Google risks
 * Merchant Center and Shopping listings. Four carts in four months is not an
 * attack. The defect is that we treat a crawler's visit as a customer's, so the
 * fix is to stop *mailing* it — never to stop it browsing, and never to delete
 * the customer record (those visits are evidence for #1328).
 *
 * ── Why the guard lives at the provider, not at the caller ────────────────────
 *
 * Lifecycle mail reaches the wire through several paths: the visual-flow
 * `send_email` op, the `send-notification-email` workflows, and direct
 * `createNotifications` calls scattered across workflows. A guard on any one of
 * those is not a guard — it just moves the leak. Every email that actually
 * leaves the platform goes through one of the three provider services we own
 * (Resend / Mailjet / Maileroo), so that is where this is enforced.
 *
 * This module is PURE and has no Medusa imports, so the policy is testable
 * without a container and cannot drift between the five call sites.
 */

/**
 * Domain suffixes whose mail we suppress, with the reason recorded in the log
 * line. Kept EXPLICIT and short — a wildcard heuristic ("anything with 'bot' in
 * it") would eventually eat a real customer, and the failure would be silent in
 * the exact way this fix exists to end.
 *
 * `joonix.net` is Google infrastructure; `storebotmail` is its shopping crawler.
 */
export const SUPPRESSED_RECIPIENT_DOMAINS: ReadonlyArray<{
  readonly suffix: string
  readonly note: string
}> = [
  { suffix: "joonix.net", note: "Google shopping crawler (storebot) infrastructure" },
]

export type RecipientVerdict = {
  /** true when this address is a known bot and must not be mailed. */
  bot: boolean
  /** The matched domain suffix, for the log line. Empty when not a bot. */
  rule: string
  /** Human-readable why, for the log line. Empty when not a bot. */
  note: string
}

const NOT_A_BOT: RecipientVerdict = { bot: false, rule: "", note: "" }

/**
 * PURE: normalize an address for matching. Lowercases and trims; tolerates a
 * `Display Name <addr@example.com>` form because provider callers do not all
 * hand us a bare address.
 */
export function normalizeRecipient(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase()
  const angled = s.match(/<([^>]+)>\s*$/)
  return (angled ? angled[1] : s).trim()
}

/**
 * PURE: is this recipient a known bot?
 *
 * Matches on the domain part only, and requires either an exact domain match or
 * a dot-boundary subdomain match — so `joonix.net` catches
 * `storebotmail.joonix.net` but never `notjoonix.net`.
 */
export function classifyRecipient(raw: unknown): RecipientVerdict {
  const email = normalizeRecipient(raw)
  const at = email.lastIndexOf("@")
  if (at < 0) return NOT_A_BOT
  const domain = email.slice(at + 1)
  if (!domain) return NOT_A_BOT

  for (const rule of SUPPRESSED_RECIPIENT_DOMAINS) {
    if (domain === rule.suffix || domain.endsWith(`.${rule.suffix}`)) {
      return { bot: true, rule: rule.suffix, note: rule.note }
    }
  }
  return NOT_A_BOT
}

/** Convenience predicate for the single-send paths. */
export function isBotRecipient(raw: unknown): boolean {
  return classifyRecipient(raw).bot
}

/**
 * PURE: split a bulk recipient list into the addresses we will mail and the
 * bot addresses we drop. Bulk paths need the same policy as single sends —
 * a crawler address inside a 50-address batch is the same waste.
 */
export function partitionBotRecipients<T>(
  entries: readonly T[],
  getEmail: (entry: T) => string
): { send: T[]; suppressed: Array<{ entry: T; verdict: RecipientVerdict }> } {
  const send: T[] = []
  const suppressed: Array<{ entry: T; verdict: RecipientVerdict }> = []
  for (const entry of entries) {
    const verdict = classifyRecipient(getEmail(entry))
    if (verdict.bot) suppressed.push({ entry, verdict })
    else send.push(entry)
  }
  return { send, suppressed }
}

/**
 * The log line every suppression emits. Suppression MUST be visible: a silent
 * drop is indistinguishable from "the mail was never triggered", which is the
 * ambiguity that let six wasted sends sit unnoticed. One shared formatter so
 * all five call sites are greppable by the same prefix.
 */
export function botSuppressionLog(
  provider: string,
  email: string,
  template: string | undefined,
  verdict: RecipientVerdict
): string {
  return (
    `[bot-recipient-suppressed] provider=${provider} ` +
    `to=${normalizeRecipient(email)} template=${template || "-"} ` +
    `rule=${verdict.rule} reason="${verdict.note}"`
  )
}

/**
 * The synthetic provider id returned in place of a real message id. Prefixed so
 * a notification row that was suppressed is distinguishable from one that was
 * actually delivered — "suppressed" must never read as "sent".
 */
export const BOT_SUPPRESSED_SEND_ID = "suppressed-bot-recipient"
