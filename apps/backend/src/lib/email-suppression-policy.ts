/**
 * Email suppression policy — the ONE place we decide whether a suppressed
 * address may still be mailed on a given channel (#1339).
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * `email_suppression` is a real ledger. Hard bounces, spam complaints and
 * unsubscribes are written to it by the Mailjet/Resend/Kit webhooks and by the
 * manual CSV job. But before this module it was consulted in exactly ONE place —
 * the Kit newsletter sync — so an address that hard-bounced was removed from the
 * *marketing* audience and kept receiving transactional and lifecycle mail
 * forever.
 *
 * A ledger that is written and never read is worse than no ledger: it creates
 * the impression the problem is handled while every send to a dead mailbox goes
 * on damaging sender reputation, which degrades delivery for addresses that are
 * perfectly valid.
 *
 * ── The channel IS the classification ─────────────────────────────────────────
 *
 * We do not have to classify templates. Prod maps channel to provider one to
 * one, and the channel already says what kind of mail it is:
 *
 *   email          → Resend   → transactional / lifecycle
 *   email_bulk     → Mailjet  → marketing / bulk
 *   email_partner  → Maileroo → partner operational
 *
 * So the whole policy is a `(reason, channel)` table. No heuristics, nothing to
 * drift.
 *
 * ── Why the guard lives at the provider ───────────────────────────────────────
 *
 * Same reason as the bot-recipient guard next to it (#1333): lifecycle mail
 * reaches the wire through the visual-flow `send_email` op, the
 * `send-notification-email` workflows, and direct `createNotifications` calls
 * scattered across workflows. A guard on any one of those is not a guard — it
 * just moves the leak. See `src/lib/bot-recipients.ts`.
 *
 * This module is PURE and has no Medusa imports, so the policy is testable
 * without a container and cannot drift between the three providers.
 */

/** Reasons as stored on `email_suppression.reason`. */
export type SuppressionReason =
  | "hard_bounce"
  | "soft_bounce"
  | "spam_complaint"
  | "unsubscribe"
  | "manual"

/** The three email channels; anything else is not email and is never suppressed here. */
export type MailChannel = "email" | "email_bulk" | "email_partner"

export const MAIL_CHANNELS: readonly MailChannel[] = [
  "email",
  "email_bulk",
  "email_partner",
]

/**
 * Two policies, both real, selectable at boot.
 *
 * `partner-carve-out` (DEFAULT) — a spam complaint blocks marketing and
 *   lifecycle mail but NOT `email_partner`. Rationale: about a fifth of prod's
 *   recent email volume is partner operational mail to 36 named partner admins.
 *   Under `strict`, one partner hitting "spam" on a quote silently stops their
 *   production-run and quote mail, and they would never know why. That is an
 *   operational failure dressed up as a deliverability win. A partner marking us
 *   as spam is a relationship problem a human should see — see
 *   `shouldAlertOnSuppression` below, which is why the carve-out is not just
 *   "ignore it".
 *
 * `strict` — a spam complaint blocks every channel including partner mail.
 *   Maximum protection for sender reputation, at the cost above. Correct if
 *   partner mail ever starts flowing through a shared reputation pool with
 *   customer mail.
 *
 * ⚠️ A hard bounce blocks EVERY channel under BOTH policies. A mailbox that does
 * not exist cannot receive partner mail either, and sending to it is pure waste.
 */
export type SuppressionMode = "partner-carve-out" | "strict"

export const DEFAULT_SUPPRESSION_MODE: SuppressionMode = "partner-carve-out"

/**
 * Resolve the active policy. `EMAIL_SUPPRESSION_MODE=strict` switches it; any
 * other value (including unset) uses the default. Deliberately fail-safe toward
 * the default rather than throwing — a typo in an env var must not take email
 * down.
 */
export function resolveSuppressionMode(
  raw: unknown = process.env.EMAIL_SUPPRESSION_MODE
): SuppressionMode {
  return String(raw ?? "").trim().toLowerCase() === "strict"
    ? "strict"
    : DEFAULT_SUPPRESSION_MODE
}

/**
 * The policy table. Each entry lists the channels the reason BLOCKS.
 *
 * `soft_bounce` blocks nothing — a soft bounce is a full mailbox or a temporary
 * server fault, and suppressing on it would drop mail to live humans. It stays
 * log-only, which is what the code already did; recorded here as a DECISION
 * rather than left as an accident of the implementation.
 *
 * `manual` blocks everything: someone put the address in by hand, on purpose.
 */
const BLOCKED_CHANNELS: Record<
  SuppressionMode,
  Record<SuppressionReason, readonly MailChannel[]>
> = {
  "partner-carve-out": {
    hard_bounce: ["email", "email_bulk", "email_partner"],
    spam_complaint: ["email", "email_bulk"],
    unsubscribe: ["email_bulk"],
    soft_bounce: [],
    manual: ["email", "email_bulk", "email_partner"],
  },
  strict: {
    hard_bounce: ["email", "email_bulk", "email_partner"],
    spam_complaint: ["email", "email_bulk", "email_partner"],
    unsubscribe: ["email_bulk"],
    soft_bounce: [],
    manual: ["email", "email_bulk", "email_partner"],
  },
}

export type SuppressionVerdict = {
  /** true when this send must not go out. */
  suppress: boolean
  /** The reason that blocked it, for the log line. Empty when not suppressed. */
  reason: SuppressionReason | ""
  /** The policy that produced the verdict, for the log line. */
  mode: SuppressionMode
}

const NOT_SUPPRESSED = (mode: SuppressionMode): SuppressionVerdict => ({
  suppress: false,
  reason: "",
  mode,
})

/**
 * PURE: given the reasons on file for an address and the channel being sent on,
 * should this send be suppressed?
 *
 * Takes the full reason list rather than one reason because an address can
 * accumulate several rows — an unsubscribe last month and a hard bounce today.
 * The strictest applicable rule wins, so a later `unsubscribe` can never
 * "downgrade" an earlier `hard_bounce`.
 */
export function classifySuppression(
  reasons: readonly SuppressionReason[],
  channel: string,
  mode: SuppressionMode = resolveSuppressionMode()
): SuppressionVerdict {
  if (!MAIL_CHANNELS.includes(channel as MailChannel)) {
    return NOT_SUPPRESSED(mode)
  }
  const table = BLOCKED_CHANNELS[mode]
  for (const reason of reasons) {
    const blocked = table[reason]
    if (blocked && blocked.includes(channel as MailChannel)) {
      return { suppress: true, reason, mode }
    }
  }
  return NOT_SUPPRESSED(mode)
}

/**
 * Should a human be told about this? A spam complaint from a partner is the
 * case the carve-out deliberately does NOT suppress — which only makes sense if
 * somebody sees it. Returns true exactly when a complaint lands on partner mail.
 */
export function shouldAlertOnSuppression(
  reasons: readonly SuppressionReason[],
  channel: string
): boolean {
  return channel === "email_partner" && reasons.includes("spam_complaint")
}

/**
 * The log line every suppression emits. Suppression MUST be visible: a silent
 * drop of a real customer's order mail would be far worse than the bug this
 * fixes. One shared formatter so every provider is greppable by one prefix —
 * the same contract as `[bot-recipient-suppressed]`.
 */
export function suppressionLog(
  provider: string,
  email: string,
  template: string | undefined,
  channel: string,
  verdict: SuppressionVerdict
): string {
  return (
    `[email-suppressed] provider=${provider} ` +
    `to=${String(email ?? "").trim().toLowerCase()} template=${template || "-"} ` +
    `channel=${channel} reason=${verdict.reason} policy=${verdict.mode}`
  )
}

/** Emitted when a partner marks us as spam and the carve-out let the mail through. */
export function partnerComplaintAlertLog(
  provider: string,
  email: string,
  template: string | undefined
): string {
  return (
    `[partner-spam-complaint] provider=${provider} ` +
    `to=${String(email ?? "").trim().toLowerCase()} template=${template || "-"} ` +
    `note="partner marked our mail as spam; delivered anyway under partner-carve-out policy"`
  )
}

/**
 * The synthetic provider id returned in place of a real message id, mirroring
 * `BOT_SUPPRESSED_SEND_ID`. Prefixed so a suppressed notification row is
 * distinguishable from a delivered one — "suppressed" must never read as "sent".
 */
export const EMAIL_SUPPRESSED_SEND_ID = "email-suppressed-no-send"
