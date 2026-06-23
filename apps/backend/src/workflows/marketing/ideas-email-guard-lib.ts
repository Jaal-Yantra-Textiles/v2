/**
 * ideas-email-guard-lib.ts — the two-layer hallucination guard for the daily
 * AI tactical-ideas email (#659 slice 2, spec 02_IDEAS_EMAIL_HALLUCINATION_GUARD_SPEC.md §3).
 *
 * PURE + framework-free + deterministic → fully unit-testable with no DB or LLM.
 * The workflow (generate-ideas-email.ts) calls `runGuard` and persists the verdict
 * to `marketing_ideas_log` BEFORE any send, so every guard decision is replayable.
 *
 * Two layers (report §7 / source spec §7.2, NON-negotiable — ship before first send):
 *   Layer A — token-placeholder substitution: the LLM references numbers ONLY via
 *             `{TOKEN}` placeholders; the server substitutes ground-truth display
 *             values. A placeholder-derived number is impossible to get wrong.
 *   Layer B — stray-literal regex validation: any number-shaped literal the LLM
 *             emitted ANYWAY is checked against the ground-truth set within ±2%.
 *             A stray with no match ⇒ the email is FLAGGED and NOT sent (fail-closed).
 */

export interface GroundTruthValue {
  token: string // "TODAY_GMV"
  value: number // 184320.5  (canonical numeric)
  display: string // "₹1,84,320"  (what gets substituted into the copy)
  unit?: string | null // "INR" | "count" | "ratio" | "percent"
}

export interface GroundTruth {
  values: GroundTruthValue[] // from marketing_metric_snapshot rows + computed deltas
  date_ist: string // "2026-06-23" — IST business day, passed into the prompt
  one_goal: string // interpolated, never invented in code
}

export interface GuardFailure {
  type: "missing_placeholder" | "stray_number"
  token: string
  value?: number | null
  nearest?: number | null
  deviationPct?: number | null
}

/** Small epsilon so an exact-0 / tiny-count ground-truth never divides by zero. */
const EPS = 1e-9

/** Default tolerance the source spec mandates for stray-literal matching. */
export const DEFAULT_TOLERANCE_PCT = 2

/**
 * Matches a number-shaped literal: optional currency prefix, optional sign, a digit
 * body with Indian/western comma grouping + optional decimal, and an OPTIONAL
 * IMMEDIATELY-ADJACENT suffix (%, K, L, M, B, Cr, Lakh, Crore). The suffix must be
 * adjacent (no space) so "5 Killer ideas" parses as 5, not 5K.
 */
const NUMERIC_RE = /(?:([₹$€£])\s?)?(-?\d[\d,]*(?:\.\d+)?)(%|Cr|Crore|Lakh|[KLMB])?/gi

const PLACEHOLDER_RE = /\{([A-Z0-9_]+)\}/g

/**
 * Normalize a matched raw token to a canonical number.
 * Strips ₹/$/€/£ and commas; expands %, K/L(akh)/M/B/Cr(ore) suffixes.
 * Returns null if the string is not a parseable number.
 *
 *   "1,84,320" → 184320   "12.5%" → 12.5   "₹4.5L" → 450000
 *   "$1.2M" → 1200000     "-3" → -3        "0.42" → 0.42
 */
export function parseNumberToken(raw: string): number | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  // strip currency symbols
  s = s.replace(/[₹$€£]/g, "").trim()

  let multiplier = 1
  const suffixMatch = s.match(/(%|Cr|Crore|Lakh|[KLMB])\s*$/i)
  if (suffixMatch) {
    const suf = suffixMatch[1].toLowerCase()
    if (suf === "%") multiplier = 1 // percent value stays as-is (12.5% → 12.5)
    else if (suf === "k") multiplier = 1e3
    else if (suf === "l" || suf === "lakh") multiplier = 1e5
    else if (suf === "m") multiplier = 1e6
    else if (suf === "cr" || suf === "crore") multiplier = 1e7
    else if (suf === "b") multiplier = 1e9
    s = s.slice(0, s.length - suffixMatch[1].length).trim()
  }

  // strip Indian + western grouping commas
  s = s.replace(/,/g, "")
  if (!/^-?\d*\.?\d+$/.test(s)) return null
  const n = parseFloat(s)
  if (Number.isNaN(n)) return null
  return n * multiplier
}

/**
 * Extract every number-shaped substring with its canonical value and index.
 * Substrings that don't parse to a number are skipped.
 */
export function extractNumericTokens(
  text: string
): Array<{ raw: string; value: number; index: number }> {
  if (!text) return []
  const out: Array<{ raw: string; value: number; index: number }> = []
  NUMERIC_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = NUMERIC_RE.exec(text)) !== null) {
    // guard against zero-width matches (the body group requires ≥1 digit, but be safe)
    if (m[0].length === 0) {
      NUMERIC_RE.lastIndex++
      continue
    }
    const raw = m[0].trim()
    const value = parseNumberToken(raw)
    if (value === null) continue
    out.push({ raw, value, index: m.index })
  }
  return out
}

/**
 * Layer A — substitute `{TOKEN}` → ground-truth display.
 * Returns the rewritten text, the unique tokens substituted, and any placeholders
 * the LLM used that we have NO ground-truth for (→ caller fails closed).
 */
export function substitutePlaceholders(
  text: string,
  gt: GroundTruth
): { text: string; substituted: string[]; missing: string[] } {
  const byToken = new Map<string, GroundTruthValue>()
  for (const v of gt.values || []) byToken.set(v.token, v)

  const substituted = new Set<string>()
  const missing = new Set<string>()

  const out = (text || "").replace(PLACEHOLDER_RE, (whole, token: string) => {
    const v = byToken.get(token)
    if (v) {
      substituted.add(token)
      return v.display
    }
    missing.add(token)
    return whole // leave intact so it's visible in the flagged log
  })

  return {
    text: out,
    substituted: Array.from(substituted),
    missing: Array.from(missing),
  }
}

/** Tolerance window around a ground-truth value g (±tolerancePct, floored at EPS). */
function toleranceFor(g: number, tolerancePct: number): number {
  return Math.max(Math.abs(g) * (tolerancePct / 100), EPS)
}

/**
 * Determine if an extracted literal is obviously-safe and should NOT be treated as
 * a claimed metric: the business-day year, a small list-marker ordinal ("1." / "2)"),
 * or a caller-supplied allow-list of exact raw literals (e.g. target "20%").
 */
function isWhitelisted(
  tok: { raw: string; value: number; index: number },
  text: string,
  yearValue: number | null,
  allowList: string[]
): boolean {
  if (allowList.includes(tok.raw)) return true
  if (yearValue !== null && tok.value === yearValue) return true
  // list marker: small integer immediately followed by "." or ")"
  if (Number.isInteger(tok.value) && tok.value >= 1 && tok.value <= 20) {
    const after = text.charAt(tok.index + tok.raw.length)
    if (after === "." || after === ")") return true
  }
  return false
}

/**
 * Layer B — every stray literal in `text` must match SOME ground-truth value within
 * tolerance, else the run fails closed. `text` should be the RAW LLM output (before
 * placeholder substitution) so legit placeholder-derived numbers aren't present yet.
 */
export function validateStrayNumbers(
  text: string,
  gt: GroundTruth,
  tolerancePct: number = DEFAULT_TOLERANCE_PCT,
  allowList: string[] = []
): {
  passed: boolean
  failures: Array<{
    token: string
    value: number
    nearest: number | null
    deviationPct: number | null
  }>
} {
  const yearValue = (() => {
    const y = parseInt(String(gt.date_ist || "").slice(0, 4), 10)
    return Number.isNaN(y) ? null : y
  })()

  const gtValues = (gt.values || []).map((v) => v.value)
  const failures: Array<{
    token: string
    value: number
    nearest: number | null
    deviationPct: number | null
  }> = []

  for (const tok of extractNumericTokens(text)) {
    if (isWhitelisted(tok, text, yearValue, allowList)) continue

    // find the nearest ground-truth value (smallest absolute distance)
    let nearest: number | null = null
    let bestDist = Infinity
    for (const g of gtValues) {
      const d = Math.abs(tok.value - g)
      if (d < bestDist) {
        bestDist = d
        nearest = g
      }
    }

    const within =
      nearest !== null && bestDist <= toleranceFor(nearest, tolerancePct)
    if (within) continue

    const deviationPct =
      nearest === null
        ? null
        : Math.abs(nearest) < EPS
          ? bestDist < EPS
            ? 0
            : Infinity
          : (bestDist / Math.abs(nearest)) * 100

    failures.push({ token: tok.raw, value: tok.value, nearest, deviationPct })
  }

  return { passed: failures.length === 0, failures }
}

/**
 * Orchestrator over a SINGLE candidate (no I/O): substitute placeholders, validate
 * stray literals against the RAW output, return a verdict. Fail-closed: any missing
 * placeholder OR any unmatched stray literal ⇒ passed = false.
 */
export function runGuard(
  rawOutput: string,
  gt: GroundTruth,
  opts?: { tolerancePct?: number; allowList?: string[] }
): {
  finalText: string
  passed: boolean
  failures: GuardFailure[]
  substituted: string[]
} {
  const tolerancePct = opts?.tolerancePct ?? DEFAULT_TOLERANCE_PCT
  const allowList = opts?.allowList ?? []

  const sub = substitutePlaceholders(rawOutput, gt)
  // Layer B runs on the RAW output (placeholders are still {TOKEN}, not numbers).
  const stray = validateStrayNumbers(rawOutput, gt, tolerancePct, allowList)

  const failures: GuardFailure[] = []
  for (const token of sub.missing) {
    failures.push({ type: "missing_placeholder", token })
  }
  for (const f of stray.failures) {
    failures.push({
      type: "stray_number",
      token: f.token,
      value: f.value,
      nearest: f.nearest,
      deviationPct: f.deviationPct,
    })
  }

  return {
    finalText: sub.text,
    passed: sub.missing.length === 0 && stray.passed,
    failures,
    substituted: sub.substituted,
  }
}
