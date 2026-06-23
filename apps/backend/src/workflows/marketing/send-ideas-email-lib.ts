/**
 * send-ideas-email-lib.ts — #659 slice 2, PR-3 (pure helpers).
 *
 * Framework-free helpers for the ideas-email SEND workflow, so recipient
 * resolution and template-data shaping are unit-testable without a running
 * Medusa container (mirrors the `partner-digest-email-lib.ts` convention).
 *
 * The send workflow (`send-ideas-email.ts`) is the only consumer.
 */

export type IdeasLogLike = {
  id: string
  output_text?: string | null
  guard_passed?: boolean | null
  sent?: boolean | null
  model_used?: string | null
  generated_for_date?: Date | string | null
}

/**
 * Pure: a guarded ideas-log row is sendable ONLY when the hallucination guard
 * passed AND there is actual copy to send. A guard-failed row never goes out
 * (spec §5.6 — fail closed); the caller sends an internal review notice instead.
 */
export function isLogSendable(log: IdeasLogLike | null | undefined): boolean {
  if (!log) return false
  if (log.guard_passed !== true) return false
  return typeof log.output_text === "string" && log.output_text.trim().length > 0
}

/**
 * Pure: parse a `MARKETING_IDEAS_RECIPIENTS` CSV env value into a deduped,
 * lower-cased list of plausible email addresses. Empty / malformed entries are
 * dropped (fail-safe: a bad env never sends to garbage). Comma- or
 * newline-separated.
 */
export function parseRecipientsCsv(csv?: string | null): string[] {
  if (!csv) return []
  return dedupeEmails(
    csv
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter((s) => looksLikeEmail(s))
  )
}

/**
 * Pure: resolve the final recipient list with explicit > CSV-env > platform
 * admins precedence. Returns a deduped, lower-cased list. The first non-empty
 * source wins (we don't union admins with an explicit override).
 */
export function resolveIdeasRecipients(opts: {
  explicit?: string[] | null
  csv?: string | null
  adminEmails?: string[] | null
}): string[] {
  const explicit = dedupeEmails((opts.explicit || []).filter(looksLikeEmail))
  if (explicit.length) return explicit

  const fromCsv = parseRecipientsCsv(opts.csv)
  if (fromCsv.length) return fromCsv

  return dedupeEmails((opts.adminEmails || []).filter(looksLikeEmail))
}

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function dedupeEmails(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const e = raw.trim().toLowerCase()
    if (!e || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}

/** Minimal HTML escape so generated copy can't inject markup into the email. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Pure: shape the Handlebars template data for the `marketing-ideas-email`
 * template. `ideas_html` is the escaped body with newlines as <br>; `ideas_text`
 * is the raw copy for a text fallback / debugging.
 */
export function buildIdeasEmailTemplateData(opts: {
  log: IdeasLogLike
  oneGoal?: string | null
  dashboardUrl?: string | null
  now?: Date
}): Record<string, any> {
  const text = (opts.log.output_text || "").trim()
  const ideasHtml = escapeHtml(text).replace(/\r?\n/g, "<br>")
  const generatedDate = formatDate(opts.log.generated_for_date)
  const year = (opts.now || new Date()).getUTCFullYear()

  return {
    ideas_text: text,
    ideas_html: ideasHtml,
    generated_date: generatedDate,
    model_used: opts.log.model_used || "",
    one_goal: opts.oneGoal || "",
    dashboard_url: opts.dashboardUrl || "",
    current_year: String(year),
  }
}

function formatDate(d?: Date | string | null): string {
  if (!d) return ""
  if (typeof d === "string") return d.slice(0, 10)
  try {
    return d.toISOString().slice(0, 10)
  } catch {
    return ""
  }
}
