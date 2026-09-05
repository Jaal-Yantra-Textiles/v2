/**
 * A concurrency ceiling for provider-bound AI work, shared across processes (#1819).
 *
 * Asked by the founder: *"maybe time has come to create a queue of workflow
 * that can wait while others are running — not to overload it with many
 * partners asking to perform the same thing."*
 *
 * ## Why this is not an in-process counter
 *
 * Prod runs **2 `medusa-server` tasks (autoscaling 1 → 5) plus a worker**, and
 * every one of them makes AI calls. An in-process ceiling is not a weaker
 * version of the right answer — it is a ceiling *per process*, so the platform's
 * real concurrency against one provider account is `ceiling × task count`, a
 * number that moves when autoscaling reacts to unrelated CPU pressure.
 *
 * So the counter has to live somewhere every process can see. It does:
 * `medusa-config.prod.ts` already registers `@medusajs/medusa/locking` with the
 * `locking-redis` provider against the same ElastiCache cluster used for the
 * cache, event bus and workflow engine. This builds on that rather than opening
 * a second Redis client.
 *
 * ## Why the key is the ACCOUNT, not the feature
 *
 * Measured in prod: **one Cloudflare account backs eight platform rows across
 * seven roles** (`ai_image_extraction`, `ai_admin_assistant`,
 * `ai_partner_assistant`, `ai_design_product_type`, `ai_digest_summary`,
 * `ai_search_chat`, `ai_search_embed`). A ceiling scoped per role or per
 * feature would let seven features each run a private budget against one key —
 * exactly the "politely take turns while both hammer the same key" the issue
 * warns about. The gate key is `(provider_type, account_id | base_url)`.
 *
 * ## How the ceiling is built out of a mutex
 *
 * The locking module gives mutual exclusion, not an N-slot semaphore. N named
 * locks make one: `ai-gate:<account>:slot:0 … slot:N-1`, scanned in order, and
 * whichever is free first is yours.
 *
 * 🔴 `acquire` is fail-fast here by construction — `awaitQueue` defaults to
 * `false` in `locking-redis`, so a held slot throws `MedusaError.CONFLICT`
 * immediately instead of blocking. That is what makes scanning slots cheap; do
 * not "fix" it by passing `awaitQueue`, or the scan would block on slot 0 while
 * slot 1 sat free.
 */

import { Modules, MedusaError } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"

export type ProviderGateKeyInput = {
  providerType: string
  accountId?: string | null
  baseUrl?: string | null
}

export type ProviderGateOptions = {
  /** Slots for this account. Defaults to {@link DEFAULT_MAX_CONCURRENCY}. */
  maxConcurrency?: number
  /**
   * How long to keep trying for a slot before giving up. Past this the caller
   * is told the platform is busy, which is a better answer than a request that
   * hangs until an edge timeout kills it (#1813).
   */
  waitMs?: number
  /**
   * Slot TTL in seconds. MUST comfortably exceed the longest provider call
   * this gate wraps — the ID-card ladder's own budget is 75s.
   */
  ttlSeconds?: number
  /** Identifies the waiter in logs; not used for correctness. */
  label?: string
}

/**
 * Two at a time per account.
 *
 * Deliberately small. #1819 records `nemotron` answering one call in 573ms and
 * rate-limiting the very next one with `ResourceExhausted: Worker local total
 * request limit` — one user, two calls. The ceiling exists because providers
 * throttle far below where we would.
 */
export const DEFAULT_MAX_CONCURRENCY = 2

/**
 * 🔴 A slot MUST have a TTL, and this is why.
 *
 * `locking-redis` applies an expiry only when `expire` is passed —
 * `args?.expire ? timeoutSeconds : 0`, and `0` means *never expires*. A task
 * killed mid-call (a deploy does exactly this, #1742) would hold its slot
 * forever, and with a small ceiling that deadlocks every AI call on the
 * platform until someone flushes Redis by hand.
 *
 * 180s: longer than the 75s ladder budget with room for a slow provider, short
 * enough that a leaked slot heals within minutes rather than being a page.
 */
export const DEFAULT_SLOT_TTL_SECONDS = 180

/** Default patience before reporting "busy" rather than waiting forever. */
export const DEFAULT_WAIT_MS = 90_000

/**
 * The identity a ceiling applies to.
 *
 * `account_id` first because that is what Cloudflare's eight rows share; the
 * base URL is the fallback for providers that do not carry one (OpenRouter,
 * DashScope, Groq, BazaarLink all resolve to their own endpoint). The provider
 * type is included so two providers cannot collide on a shared default.
 */
export const providerGateKey = (input: ProviderGateKeyInput): string => {
  const scope =
    (input.accountId && String(input.accountId).trim()) ||
    (input.baseUrl && String(input.baseUrl).trim()) ||
    "default"
  return `ai-gate:${input.providerType}:${scope}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class ProviderBusyError extends Error {
  constructor(key: string, waitedMs: number) {
    super(
      `Every slot for ${key} was busy for ${Math.round(
        waitedMs / 1000
      )}s. The platform is running as much AI work as this provider account allows — try again shortly.`
    )
    this.name = "ProviderBusyError"
  }
}

/**
 * Runs `job` while holding one of the account's slots.
 *
 * Degrades to running the job ungated if the locking module is not registered
 * (some test containers). That is deliberate: a missing gate must not take AI
 * features down, and the in-memory default still serializes within a process.
 * It is logged so the degradation is never silent — the failure this platform
 * keeps meeting is work that is quietly not happening.
 */
export const withProviderSlot = async <T>(
  container: any,
  key: string,
  job: () => Promise<T>,
  options: ProviderGateOptions = {}
): Promise<T> => {
  const maxConcurrency = Math.max(
    1,
    options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
  )
  const ttlSeconds = Math.max(
    1,
    options.ttlSeconds ?? DEFAULT_SLOT_TTL_SECONDS
  )
  const waitMs = Math.max(0, options.waitMs ?? DEFAULT_WAIT_MS)

  let locking: any = null
  let logger: any = null
  try {
    locking = container.resolve(Modules.LOCKING)
  } catch {
    locking = null
  }
  try {
    logger = container.resolve("logger")
  } catch {
    logger = null
  }

  if (!locking) {
    logger?.warn?.(
      `[ai-gate] locking module unavailable — running ${key} UNGATED`
    )
    return job()
  }

  /**
   * Unique per acquisition. `locking-redis` falls back to owner `"*"` when none
   * is given, and a `"*"` lock "can be extended or released by anyone" — so two
   * callers would happily release each other's slot and the ceiling would stop
   * meaning anything.
   */
  const ownerId = `${process.pid}:${randomUUID()}`
  const startedAt = Date.now()
  let attempt = 0

  for (;;) {
    for (let slot = 0; slot < maxConcurrency; slot++) {
      const slotKey = `${key}:slot:${slot}`
      try {
        await locking.acquire(slotKey, { ownerId, expire: ttlSeconds })
      } catch {
        // CONFLICT — this slot is taken. Try the next one; never wait here.
        continue
      }

      try {
        return await job()
      } finally {
        // Release must not mask the job's own error.
        await locking.release(slotKey, { ownerId }).catch(() => {})
      }
    }

    const waited = Date.now() - startedAt
    if (waited >= waitMs) {
      throw new ProviderBusyError(key, waited)
    }

    /**
     * Jittered backoff. Without jitter every waiter wakes together and scans
     * the same slots in the same order — the thundering herd that makes a
     * ceiling behave worse than no ceiling under load.
     */
    attempt++
    const base = Math.min(250 * 2 ** Math.min(attempt, 5), 4_000)
    const delay = Math.min(base * (0.5 + Math.random() * 0.5), waitMs - waited)
    await sleep(Math.max(delay, 50))
  }
}

/**
 * Resolves the ceiling for an account.
 *
 * `AI_GATE_MAX_CONCURRENCY` is the blunt platform-wide override;
 * `AI_GATE_MAX_CONCURRENCY__<PROVIDER_TYPE>` narrows it to one provider, which
 * is what a paid account with real headroom wants without lifting the ceiling
 * for the free rungs beside it.
 */
export const resolveMaxConcurrency = (
  providerType: string,
  env: Record<string, string | undefined> = process.env
): number => {
  const perProvider =
    env[`AI_GATE_MAX_CONCURRENCY__${providerType.toUpperCase()}`]
  const global = env.AI_GATE_MAX_CONCURRENCY
  const raw = perProvider ?? global
  const n = Number(raw)
  // 🔑 `Number(undefined)` is NaN but `Number("")` and `Number(null)` are 0 —
  // and a ceiling of 0 would block every call forever. Demand a real positive.
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_CONCURRENCY
}

export const isProviderBusyError = (e: unknown): boolean =>
  e instanceof ProviderBusyError ||
  (e as any)?.name === "ProviderBusyError" ||
  ((e as any)?.type === MedusaError.Types.CONFLICT &&
    String((e as any)?.message ?? "").includes("ai-gate:"))
