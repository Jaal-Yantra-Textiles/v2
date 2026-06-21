/**
 * @file Partner storefront digest — AI summary generation (pure / injectable).
 * @module workflows/analytics/partner-digest-ai-lib
 *
 * #589 item 3 (last slice). Turns a computed {@link PartnerStorefrontDigest}
 * into a short, warm natural-language "how your week went" paragraph that the
 * email renders above the KPIs (the `{{#if ai_summary}}` block added by the
 * slice-3 data contract).
 *
 * Split so the deterministic parts are unit-testable WITHOUT a network call:
 *   - {@link buildDigestAiPrompt} — PURE: digest → `{ system, prompt }`.
 *   - {@link composeDigestAiSummary} — orchestration with an INJECTED model
 *     call (`generate`), so tests pass a fake and never hit OpenRouter.
 *
 * The live wiring (a real OpenRouter-backed `generate`) lives in the
 * `partner_analytics_digest` operation behind a default-OFF option, so the
 * weekly flow's behaviour is unchanged until an admin opts in.
 */

import {
  type DigestMetric,
  type DigestBreakdownItem,
  type PartnerStorefrontDigest,
} from "./partner-digest-lib";
import { digestHasData, sanitizeAiSummary } from "./partner-digest-email-lib";

/** Mirrors the `ai_extract` operation default so flows stay consistent. */
export const DIGEST_AI_DEFAULT_MODEL = "google/gemini-2.5-flash-preview";

/**
 * The model-call seam. The operation supplies a real OpenRouter-backed
 * implementation; unit tests supply a fake. Must resolve to the raw text the
 * model produced (sanitisation happens here, not in the caller).
 */
export type DigestAiGenerate = (args: {
  system: string;
  prompt: string;
  model: string;
}) => Promise<string>;

/** Compact, deterministic one-liner for a single KPI (no unicode arrows). */
function fmtMetric(label: string, m: DigestMetric | null | undefined): string {
  if (!m) return `${label}: n/a`;
  const cur = Number.isFinite(m.current) ? m.current : 0;
  if (m.delta_pct === null || m.delta_pct === undefined) {
    return `${label}: ${cur} (no prior baseline)`;
  }
  const sign = m.delta_pct > 0 ? "+" : "";
  return `${label}: ${cur} (${sign}${m.delta_pct}% vs previous, ${m.direction})`;
}

/** Top-N breakdown rows rendered as "value (pct%)" for the prompt. */
function fmtTop(items: DigestBreakdownItem[] | null | undefined, n: number): string {
  const rows = (items ?? []).slice(0, n);
  if (!rows.length) return "none";
  return rows.map((r) => `${r.value} (${r.percentage}%)`).join(", ");
}

/**
 * Build the system + user prompt for the weekly AI summary. PURE and
 * deterministic — identical digest in ⇒ identical prompt out (unit-testable,
 * cache-friendly). Never throws on partial digests.
 */
export function buildDigestAiPrompt(digest: PartnerStorefrontDigest): {
  system: string;
  prompt: string;
} {
  const system =
    "You write a short, warm weekly storefront performance summary for a " +
    "textile/handloom seller. Write 1-2 plain-text sentences (max ~70 words), " +
    "no markdown, no bullet points, no greeting or sign-off. Be encouraging " +
    "and specific to the numbers; if traffic fell, stay constructive. Return " +
    "only the summary text.";

  const store =
    digest?.website?.name?.trim() ||
    digest?.website?.domain?.trim() ||
    "your storefront";
  const periodLabel = digest?.period?.label ?? "this period";
  const k = digest?.kpis;
  const bd = digest?.breakdowns;

  const lines = [
    `Store: ${store}`,
    `Period: ${periodLabel}`,
    fmtMetric("Unique visitors", k?.unique_visitors),
    fmtMetric("Pageviews", k?.pageviews),
    fmtMetric("Sessions", k?.sessions),
    fmtMetric("Bounce rate", k?.bounce_rate),
    `Top pages: ${fmtTop(bd?.top_pages, 3)}`,
    `Top referrers: ${fmtTop(bd?.referrers, 3)}`,
    `Top devices: ${fmtTop(bd?.devices, 2)}`,
  ];

  const suggestions = Array.isArray(digest?.suggestions) ? digest.suggestions : [];
  if (suggestions.length) {
    lines.push(
      `Suggestions already surfaced: ${suggestions
        .slice(0, 4)
        .map((s) => s.title)
        .join("; ")}`
    );
  }

  return { system, prompt: lines.join("\n") };
}

/**
 * Generate (best-effort) a sanitised AI summary for one digest.
 *
 * - Skips entirely (returns `null`) when the digest has no traffic data — the
 *   zero-data "start sharing" nudge (#589 item 2) covers that case instead.
 * - Runs the model output through {@link sanitizeAiSummary} (collapse + cap).
 * - NEVER throws: any model/parse failure resolves to `null` so the weekly
 *   run is never aborted by an AI hiccup.
 *
 * Returns the summary string, or `null` to leave `digest.ai_summary` unset.
 */
export async function composeDigestAiSummary(
  digest: PartnerStorefrontDigest,
  generate: DigestAiGenerate,
  opts?: { model?: string }
): Promise<string | null> {
  try {
    if (!digest || !digestHasData(digest)) return null;
    const { system, prompt } = buildDigestAiPrompt(digest);
    const model = opts?.model?.trim() || DIGEST_AI_DEFAULT_MODEL;
    const raw = await generate({ system, prompt, model });
    const summary = sanitizeAiSummary(raw);
    return summary.length > 0 ? summary : null;
  } catch {
    return null;
  }
}
