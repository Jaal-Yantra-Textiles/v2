/**
 * Reads the `email_suppression` ledger from inside a notification provider (#1339).
 *
 * ── Why this is a raw query and not a module service ──────────────────────────
 *
 * Notification providers are constructed as `new klass(cradle, options)` where
 * `cradle` is the NOTIFICATION MODULE'S OWN container — not the app container.
 * Probed directly by dumping the keys at construction:
 *
 *   event_bus, logger, manager, configModule, __pg_connection__, caching,
 *   __providers__…, notificationModuleService, baseRepository, …
 *
 * `email_suppression` is NOT there, and no amount of declaring it as a
 * dependency puts it there — other modules are simply not resolvable from a
 * provider (the same boundary that hides fulfillment providers from the app
 * container). What IS there is `__pg_connection__`, a connection to the same
 * database. So the provider reads the one indexed column it needs directly.
 *
 * ── Fail OPEN, and loudly ─────────────────────────────────────────────────────
 *
 * If the lookup cannot run, we SEND. The asymmetry is the whole point: mailing a
 * dead address costs reputation slowly, whereas silently dropping a customer's
 * order confirmation is invisible and unrecoverable. Every failure is logged at
 * error level with a stable prefix so "the guard is not running" can never look
 * like "nothing was suppressed".
 */
import type { Logger } from "@medusajs/framework/types"
import {
  classifySuppression,
  shouldAlertOnSuppression,
  suppressionLog,
  partnerComplaintAlertLog,
  EMAIL_SUPPRESSED_SEND_ID,
  type SuppressionReason,
} from "./email-suppression-policy"

/** How long a lookup result is reused. Short: a new hard bounce should take
 * effect within a minute, and prod runs more than one instance, so a long TTL
 * would let instances disagree for as long as it lasted. */
export const SUPPRESSION_CACHE_TTL_MS = 60_000

/** Hard ceiling so a burst of unique addresses cannot grow the cache unbounded. */
export const SUPPRESSION_CACHE_MAX_ENTRIES = 5_000

type CacheEntry = { reasons: SuppressionReason[]; expiresAt: number }

export type SuppressionLookup = (email: string) => Promise<SuppressionReason[]>

export const normalizeSuppressionEmail = (raw: unknown): string => {
  const s = String(raw ?? "").trim().toLowerCase()
  const angled = s.match(/<([^>]+)>\s*$/)
  return (angled ? angled[1] : s).trim()
}

/**
 * Build a cached lookup bound to one provider.
 *
 * `pg` is whatever `cradle.__pg_connection__` holds (a knex instance). It is
 * typed loosely on purpose: the provider must keep working if the key is
 * missing, which is exactly the case this guards.
 */
export function createSuppressionLookup(opts: {
  pg: any
  logger: Logger
  provider: string
  now?: () => number
}): SuppressionLookup {
  const { pg, logger, provider } = opts
  const now = opts.now ?? (() => Date.now())
  const cache = new Map<string, CacheEntry>()
  let warnedMissingConnection = false

  return async (rawEmail: string): Promise<SuppressionReason[]> => {
    const email = normalizeSuppressionEmail(rawEmail)
    if (!email) {
      return []
    }

    const hit = cache.get(email)
    if (hit && hit.expiresAt > now()) {
      return hit.reasons
    }

    if (!pg || typeof pg.raw !== "function") {
      // Loud, but only once per provider instance — a per-send error line here
      // would bury the log without telling anyone anything new.
      if (!warnedMissingConnection) {
        warnedMissingConnection = true
        logger.error(
          `[email-suppression-unavailable] provider=${provider} ` +
            `reason="no __pg_connection__ in provider container" ` +
            `impact="suppression ledger is NOT being enforced on this channel"`
        )
      }
      return []
    }

    try {
      const result = await pg.raw(
        `select distinct reason
           from email_suppression
          where lower(email) = ?
            and deleted_at is null`,
        [email]
      )
      const reasons = (result?.rows ?? [])
        .map((r: any) => r?.reason)
        .filter(Boolean) as SuppressionReason[]

      if (cache.size >= SUPPRESSION_CACHE_MAX_ENTRIES) {
        cache.clear()
      }
      cache.set(email, { reasons, expiresAt: now() + SUPPRESSION_CACHE_TTL_MS })
      return reasons
    } catch (e: any) {
      // Fail OPEN — see the header. Never let a ledger outage stop real mail.
      logger.error(
        `[email-suppression-lookup-failed] provider=${provider} ` +
          `to=${email} error="${String(e?.message ?? e).slice(0, 200)}" ` +
          `impact="sent without consulting the ledger"`
      )
      return []
    }
  }
}

/**
 * The whole guard, ready to drop into a provider's `send()`.
 *
 * ⚠️ `ProviderSendNotificationDTO` does NOT carry the channel — it has `to`,
 * `from`, `template`, `data`, `content` and nothing else. So each provider must
 * declare the channel it serves. That is safe here because prod maps channel to
 * provider one to one (`email`→Resend, `email_bulk`→Mailjet,
 * `email_partner`→Maileroo); the value is taken from the provider's own
 * `options.channels[0]` when present so config stays the single source of truth,
 * with the prod mapping as the fallback.
 */
export function createSuppressionGuard(opts: {
  pg: any
  logger: Logger
  provider: string
  channel: string
}): (to: string, template?: string) => Promise<{ suppress: boolean; id: string }> {
  const { logger, provider, channel } = opts
  const lookup = createSuppressionLookup(opts)

  return async (to: string, template?: string) => {
    const reasons = await lookup(to)
    if (!reasons.length) {
      return { suppress: false, id: "" }
    }

    // Raised even when the mail is delivered: under the carve-out a partner's
    // spam complaint does NOT suppress, and that only makes sense if a human
    // finds out. Logged before the verdict so it survives either policy.
    if (shouldAlertOnSuppression(reasons, channel)) {
      logger.warn(partnerComplaintAlertLog(provider, to, template))
    }

    const verdict = classifySuppression(reasons, channel)
    if (!verdict.suppress) {
      return { suppress: false, id: "" }
    }

    logger.warn(suppressionLog(provider, to, template, channel, verdict))
    return { suppress: true, id: EMAIL_SUPPRESSED_SEND_ID }
  }
}

/**
 * Bulk counterpart. A suppressed address inside a 50-address batch is the same
 * damage as a single send, so the bulk paths get the same policy — this is the
 * mistake `partitionBotRecipients` exists to avoid repeating.
 *
 * Returns the entries to send plus the dropped ones with their verdicts, so the
 * caller can log each drop individually rather than a single opaque count.
 */
export async function partitionSuppressedRecipients<T>(
  entries: readonly T[],
  getEmail: (entry: T) => string,
  guard: (to: string, template?: string) => Promise<{ suppress: boolean; id: string }>
): Promise<{ send: T[]; suppressed: T[] }> {
  const send: T[] = []
  const suppressed: T[] = []
  for (const entry of entries) {
    const verdict = await guard(getEmail(entry))
    if (verdict.suppress) suppressed.push(entry)
    else send.push(entry)
  }
  return { send, suppressed }
}
