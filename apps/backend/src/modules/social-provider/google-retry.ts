import type { Logger } from "@medusajs/types"

export type GoogleRetryOptions = {
  /** Max total attempts including the first try. Default 5. */
  maxAttempts?: number
  /** Base delay in ms for exponential backoff. Default 500. */
  baseDelayMs?: number
  /** Cap for any single delay. Default 30000 (30s). */
  maxDelayMs?: number
  /** Tag for log lines so we know which call retried. */
  label: string
  /** Optional logger to emit retry warnings. */
  logger?: Logger
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
])

function isRetryable(err: any): boolean {
  if (err?.response?.status && RETRYABLE_STATUS.has(err.response.status)) return true
  if (err?.code && RETRYABLE_CODES.has(err.code)) return true
  return false
}

function parseRetryAfter(err: any): number | null {
  const header = err?.response?.headers?.["retry-after"]
  if (!header) return null
  const asNum = Number(header)
  if (Number.isFinite(asNum) && asNum > 0) return Math.floor(asNum * 1000)
  const asDate = Date.parse(String(header))
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now()
    return delta > 0 ? delta : null
  }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Wraps a single Google API call with exponential backoff + jitter.
 *
 * Retries on 408 / 429 / 5xx and common network errors. Respects the
 * `Retry-After` header when Google sends one (Business Profile and quota
 * errors usually do). Non-retryable errors propagate immediately so the
 * caller can surface a precise message to the operator.
 */
export async function withGoogleRetry<T>(
  fn: () => Promise<T>,
  opts: GoogleRetryOptions
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5
  const baseDelay = opts.baseDelayMs ?? 500
  const maxDelay = opts.maxDelayMs ?? 30_000

  let lastErr: any
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      const retryable = isRetryable(err) && attempt < maxAttempts
      if (!retryable) throw err

      const retryAfterMs = parseRetryAfter(err)
      const expDelay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay)
      // Full jitter: random delay in [expDelay/2, expDelay].
      const jittered = Math.floor(expDelay / 2 + Math.random() * (expDelay / 2))
      const delay = Math.max(retryAfterMs ?? 0, jittered)

      const status = err?.response?.status ?? err?.code ?? "unknown"
      opts.logger?.warn?.(
        `[google] ${opts.label} attempt ${attempt}/${maxAttempts} failed (${status}); retrying in ${delay}ms`
      )
      await sleep(delay)
    }
  }
  throw lastErr
}
