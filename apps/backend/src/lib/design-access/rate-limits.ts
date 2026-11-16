/**
 * Rate limits for the public storefront design chat (#2543).
 *
 * The chat and its tools are public (guest makers), and every chat turn is a
 * paid model call while every `generate_design_image` is TWO paid image
 * generations. These caps stop a runaway client or a script from turning the
 * endpoint into a free LLM / image-gen proxy.
 *
 * ⚠️ In-process, like `createRateLimitMiddleware` in api/middlewares.ts: each
 * server instance counts on its own, so the effective cap is (limit ×
 * instances). Good enough to stop abuse; not an exact quota.
 *
 * ⚠️ IP keys come from the LEFTMOST `x-forwarded-for` entry (the storefront
 * proxy forwards the shopper's IP there). That entry is client-claimable, so
 * per-IP and per-visitor caps only stop clients that are not trying to dodge
 * them. The per-design and GLOBAL image caps are the ones a caller cannot
 * sidestep — a design id needs a token, and the global ceiling has no key.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export type RateLimitConfig = { windowMs: number; max: number }

/** POST /store/ai/chat — per visitor id (body `visitor_id`). */
export const CHAT_LIMIT_PER_VISITOR: RateLimitConfig = { windowMs: 5 * MINUTE, max: 30 }
/** POST /store/ai/chat — per client IP (looser: several shoppers share NATs). */
export const CHAT_LIMIT_PER_IP: RateLimitConfig = { windowMs: 5 * MINUTE, max: 60 }

/** generate_design_image — each call is TWO paid generations. */
export const IMAGE_GEN_LIMIT_PER_DESIGN: RateLimitConfig = { windowMs: HOUR, max: 6 }
export const IMAGE_GEN_LIMIT_PER_IP: RateLimitConfig = { windowMs: HOUR, max: 12 }
/** Process-wide backstop no key rotation can dodge. */
export const IMAGE_GEN_LIMIT_GLOBAL: RateLimitConfig = { windowMs: HOUR, max: 300 }

/** POST /store/custom/design-assistant/references — upload + vision per file. */
export const REFERENCES_LIMIT_PER_IP: RateLimitConfig = { windowMs: 10 * MINUTE, max: 20 }
/** POST /store/custom/design-assistant/references/analyze — one vision call. */
export const ANALYZE_LIMIT_PER_IP: RateLimitConfig = { windowMs: 10 * MINUTE, max: 30 }

/** Bound memory: prune expired buckets once a limiter tracks this many keys. */
const PRUNE_AT = 5_000

export type RateLimitResult = {
  allowed: boolean
  /** ms until the current window resets (0 when allowed and fresh). */
  retryAfterMs: number
}

export type FixedWindowLimiter = {
  /** Count one hit against `key`. */
  hit: (key: string) => RateLimitResult
  /** Would a hit be allowed? Does not count. */
  check: (key: string) => RateLimitResult
  reset: () => void
}

export const createFixedWindowLimiter = (
  config: RateLimitConfig,
  now: () => number = Date.now
): FixedWindowLimiter => {
  const buckets = new Map<string, { resetAt: number; count: number }>()

  const prune = (t: number) => {
    if (buckets.size < PRUNE_AT) return
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k)
  }

  const check = (key: string): RateLimitResult => {
    const t = now()
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= t) return { allowed: true, retryAfterMs: 0 }
    return bucket.count >= config.max
      ? { allowed: false, retryAfterMs: bucket.resetAt - t }
      : { allowed: true, retryAfterMs: 0 }
  }

  const hit = (key: string): RateLimitResult => {
    const t = now()
    prune(t)
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= t) {
      buckets.set(key, { resetAt: t + config.windowMs, count: 1 })
      return { allowed: true, retryAfterMs: 0 }
    }
    if (bucket.count >= config.max) {
      return { allowed: false, retryAfterMs: bucket.resetAt - t }
    }
    bucket.count += 1
    return { allowed: true, retryAfterMs: 0 }
  }

  return { hit, check, reset: () => buckets.clear() }
}

export const retryAfterMinutes = (ms: number): number =>
  Math.max(1, Math.ceil(ms / MINUTE))

export const tooManyRequestsMessage = (retryAfterMs: number): string =>
  `Too many requests. Try again in ${retryAfterMinutes(retryAfterMs)} min.`

/** Client IP: leftmost x-forwarded-for, else the socket peer. */
export const clientIpOf = (req: any): string => {
  const xff = req?.headers?.["x-forwarded-for"]
  const first = (Array.isArray(xff) ? xff[0] : xff || "").split(",")[0]?.trim()
  return first || req?.socket?.remoteAddress || "unknown"
}

// ── Shared limiter instances (one per process) ───────────────────────────

export const chatVisitorLimiter = createFixedWindowLimiter(CHAT_LIMIT_PER_VISITOR)
export const chatIpLimiter = createFixedWindowLimiter(CHAT_LIMIT_PER_IP)
export const imageGenDesignLimiter = createFixedWindowLimiter(IMAGE_GEN_LIMIT_PER_DESIGN)
export const imageGenIpLimiter = createFixedWindowLimiter(IMAGE_GEN_LIMIT_PER_IP)
export const imageGenGlobalLimiter = createFixedWindowLimiter(IMAGE_GEN_LIMIT_GLOBAL)
export const referencesIpLimiter = createFixedWindowLimiter(REFERENCES_LIMIT_PER_IP)
export const analyzeIpLimiter = createFixedWindowLimiter(ANALYZE_LIMIT_PER_IP)

export class ImageGenRateLimitError extends Error {
  readonly code = "rate_limited"
  constructor(readonly retryAfterMs: number, scope: "design" | "ip" | "global") {
    super(
      scope === "design"
        ? `Too many image generations for this design. Try again in ${retryAfterMinutes(retryAfterMs)} min.`
        : `Too many image generations right now. Try again in ${retryAfterMinutes(retryAfterMs)} min.`
    )
    this.name = "ImageGenRateLimitError"
  }
}

/**
 * Count one generation against the design, the IP and the global ceiling.
 * Checks all three first so a refusal on one does not burn the others.
 * Throws `ImageGenRateLimitError` when any is exhausted.
 */
export const consumeImageGeneration = (input: {
  designId: string
  ip?: string | null
}): void => {
  // An unknown IP is skipped rather than pooled: one shared "unknown" bucket
  // would let a single missing header throttle every maker at once. The
  // per-design and global caps still apply.
  const ip = input.ip && input.ip !== "unknown" ? input.ip : null
  const checks: Array<[FixedWindowLimiter, string, "design" | "ip" | "global"]> = [
    [imageGenDesignLimiter, `design:${input.designId}`, "design"],
    ...(ip ? [[imageGenIpLimiter, `ip:${ip}`, "ip"] as [FixedWindowLimiter, string, "ip"]] : []),
    [imageGenGlobalLimiter, "global", "global"],
  ]
  for (const [limiter, key, scope] of checks) {
    const r = limiter.check(key)
    if (!r.allowed) throw new ImageGenRateLimitError(r.retryAfterMs, scope)
  }
  for (const [limiter, key] of checks) limiter.hit(key)
}

/**
 * Express-style middleware: 429 with `Retry-After` when any of the keys is
 * over its limit. Keys come from `keysOf(req)`; a null key is skipped.
 */
export const createKeyedRateLimitMiddleware = (
  limits: Array<{ limiter: FixedWindowLimiter; keyOf: (req: any) => string | null }>
) => {
  return (req: any, res: any, next: (err?: any) => void) => {
    const keyed = limits
      .map(({ limiter, keyOf }) => ({ limiter, key: keyOf(req) }))
      .filter((k): k is { limiter: FixedWindowLimiter; key: string } => !!k.key)

    for (const { limiter, key } of keyed) {
      const r = limiter.check(key)
      if (!r.allowed) {
        res.setHeader("Retry-After", Math.max(1, Math.ceil(r.retryAfterMs / 1000)).toString())
        res.status(429).json({
          code: "rate_limited",
          message: tooManyRequestsMessage(r.retryAfterMs),
          retry_after_seconds: Math.max(1, Math.ceil(r.retryAfterMs / 1000)),
        })
        return
      }
    }
    for (const { limiter, key } of keyed) limiter.hit(key)
    next()
  }
}

/** POST /store/ai/chat — per visitor id + per IP. */
export const chatRateLimitMiddleware = createKeyedRateLimitMiddleware([
  {
    limiter: chatVisitorLimiter,
    keyOf: (req) => {
      const v = req?.body?.visitor_id
      return typeof v === "string" && v ? `visitor:${v.slice(0, 80)}` : null
    },
  },
  { limiter: chatIpLimiter, keyOf: (req) => `ip:${clientIpOf(req)}` },
])

export const referencesRateLimitMiddleware = createKeyedRateLimitMiddleware([
  { limiter: referencesIpLimiter, keyOf: (req) => `ip:${clientIpOf(req)}` },
])

export const analyzeRateLimitMiddleware = createKeyedRateLimitMiddleware([
  { limiter: analyzeIpLimiter, keyOf: (req) => `ip:${clientIpOf(req)}` },
])

// ── Email sign-in codes (#2543 phase 2) ─────────────────────────────────

/** POST /auth/customer/email-otp `{ email }` — code sends per address. */
export const EMAIL_OTP_SEND_LIMIT_PER_EMAIL: RateLimitConfig = { windowMs: 15 * MINUTE, max: 3 }
/** …and per client IP (one script cannot mail-bomb many inboxes). */
export const EMAIL_OTP_SEND_LIMIT_PER_IP: RateLimitConfig = { windowMs: HOUR, max: 10 }

export const emailOtpEmailLimiter = createFixedWindowLimiter(EMAIL_OTP_SEND_LIMIT_PER_EMAIL)
export const emailOtpIpLimiter = createFixedWindowLimiter(EMAIL_OTP_SEND_LIMIT_PER_IP)

/** The address a send is for, normalised the way the provider does. */
const otpSendEmailOf = (req: any): string | null => {
  const raw = req?.body?.email
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase().slice(0, 254) : null
}

const isOtpSend = (req: any): boolean => {
  const code = req?.body?.code
  return !(typeof code === "string" && code.trim())
}

const emailOtpSendLimiter = createKeyedRateLimitMiddleware([
  {
    limiter: emailOtpEmailLimiter,
    keyOf: (req) => {
      const email = otpSendEmailOf(req)
      return email ? `email:${email}` : null
    },
  },
  { limiter: emailOtpIpLimiter, keyOf: (req) => `ip:${clientIpOf(req)}` },
])

/**
 * Caps code SENDS only. A verify (`{ email, code }`) passes straight through:
 * guesses are bounded per code by the provider's attempt counter, and a send
 * cap of 3 per 15 min bounds how many fresh codes (and so guesses) one address
 * can be given.
 */
export const emailOtpSendRateLimitMiddleware = (req: any, res: any, next: (err?: any) => void) =>
  isOtpSend(req) ? emailOtpSendLimiter(req, res, next) : next()
