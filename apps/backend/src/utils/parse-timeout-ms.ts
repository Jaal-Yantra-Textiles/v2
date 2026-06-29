// Parse a millisecond timeout from an env var (or any raw string) with a safe
// fallback.
//
// Background (#742): timeout windows were hardcoded at 10_000ms in two hot
// paths — the mastra step executor (`DEFAULT_STEP_TIMEOUT_MS`) and the
// visual-flow `execute_code` sandboxed `fetch`. Ten seconds is too short for
// real work (LLM calls routinely take 15–60s), so non-trivial steps timed out
// and failed. Making the window env-configurable lets ops raise it without a
// code change, while keeping a sane default.
//
// `parseInt(env || "60000", 10)` is NOT enough on its own: it only guards
// undefined/empty, so "garbage" → NaN and "-5" → a negative timeout that fires
// immediately. This helper rejects NaN, non-finite, zero, and negative values,
// always returning a usable positive integer.
//
// Pure: no I/O, no throws. Fractions are floored (`AbortSignal.timeout` and
// `setTimeout` expect integer ms).
export function parseTimeoutMs(
  raw: string | undefined | null,
  fallback: number
): number {
  if (raw == null) {
    return fallback
  }

  const trimmed = raw.trim()
  if (trimmed === "") {
    return fallback
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.floor(parsed)
}
