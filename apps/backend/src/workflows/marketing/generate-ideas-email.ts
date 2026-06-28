/**
 * generate-ideas-email.ts — #659 slice 2, PR-2.
 *
 * The "AI tactical-ideas email" generate workflow: read today's ground-truth
 * numbers from `marketing_metric_snapshot`, ask the LLM for 3-5 tactical moves
 * (referring to numbers ONLY by {TOKEN} placeholder), run the two-layer
 * hallucination guard (`ideas-email-guard-lib.ts`), regenerate ONCE on failure,
 * then persist a `marketing_ideas_log` row BEFORE anything is ever sent
 * (report §4.3: "every job writes its result to Postgres before sending").
 *
 * Testability: the AI call is an INJECTABLE function (`AiGenerateFn`) — the
 * integration test passes a stub returning fixed `{TOKEN}` copy, so CI NEVER
 * calls a live LLM. The Medusa workflow wrapper injects the real OpenRouter
 * call (mirrors the verified pattern in
 * `src/workflows/ad-planning/sentiment/analyze-sentiment.ts:44-71`).
 *
 * This PR does NOT send the email — `sent` stays false; the send workflow
 * (PR-3) flips it. The job that schedules this (PR-4) stays disabled until the
 * One Goal is picked.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { makeRoleAiGenerate } from "../../mastra/services/ai-platforms"

import { MARKETING_MODULE } from "../../modules/marketing"
import type { GroundTruth, GroundTruthValue } from "./ideas-email-guard-lib"
import { runGuard } from "./ideas-email-guard-lib"
import { buildIdeasPrompt, STRICTER_SUFFIX } from "./ideas-email-prompt-lib"

/** An injectable LLM call: prompt in, raw text out (or "" on failure). */
export type AiGenerateFn = (prompt: string) => Promise<string>

export type GenerateIdeasEmailOptions = {
  /** Injected for tests; defaults to the role-resolved platform generator
   *  (ai_newsletter_drafter → configured platform, else free models). */
  aiGenerate?: AiGenerateFn
  /** The "One Goal" string; never invented in code (report §3.6). */
  oneGoal?: string
  /** Business description fed to the prompt. */
  businessDescription?: string
  /** Reference "now"; defaults to current time. Used only for the IST date. */
  now?: Date
  /** Stray-literal tolerance forwarded to the guard. */
  tolerancePct?: number
  /** Extra numeric literals the guard is allowed to ignore. */
  allowList?: string[]
}

export type GenerateIdeasEmailResult = {
  skipped: boolean
  generated: boolean
  guard_passed: boolean
  regenerated: boolean
  log_id: string | null
  output_text: string
  model_used: string
  ground_truth: GroundTruth | null
  reason?: string
}

/** Role this generator resolves a platform for (free-model fallback). */
const IDEAS_EMAIL_ROLE = "ai_newsletter_drafter"

const DEFAULT_BUSINESS_DESCRIPTION =
  "JYT is a textile-production commerce platform: it runs an admin storefront " +
  "and onboards partner brands who sell their own products through per-partner " +
  "storefronts. Revenue comes from product sales (GMV) across these stores."

// IST = UTC+5:30. Return the IST calendar date (YYYY-MM-DD) for a UTC instant.
function istDateString(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  return ist.toISOString().slice(0, 10)
}

/**
 * Pure: format a canonical numeric value for human display in the email copy.
 * The guard validates stray literals against the RAW (pre-substitution) output,
 * so this display string only affects the final rendered copy — it can be as
 * human-friendly as we like without tripping Layer B.
 */
export function formatMetricDisplay(
  value: number,
  unit?: string | null
): string {
  const u = (unit || "").toLowerCase()
  if (u === "inr") return "₹" + Math.round(value).toLocaleString("en-IN")
  if (u === "usd") return "$" + Math.round(value).toLocaleString("en-US")
  if (u === "percent") return `${round1(value)}%`
  if (u === "ratio") return `${round1(value * 100)}%`
  if (u === "count") return Math.round(value).toLocaleString("en-IN")
  return String(value)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function tokenFor(metricKey: string): string {
  return metricKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
}

/**
 * Pure: map the latest snapshot row per metric_key into a GroundTruth. Each
 * metric becomes a {METRIC_KEY} token; a present `delta_dod` becomes a separate
 * {METRIC_KEY_DELTA_DOD} percent token so the model can reference the trend.
 */
export function buildGroundTruthFromSnapshots(
  rows: Array<{
    metric_key: string
    value: number
    unit?: string | null
    captured_for_date: Date | string
    delta_dod?: number | null
  }>,
  opts: { dateIst: string; oneGoal: string }
): GroundTruth {
  const seen = new Set<string>()
  const values: GroundTruthValue[] = []

  // rows arrive newest-first; keep the first (latest) row per metric_key.
  for (const r of rows) {
    if (seen.has(r.metric_key)) continue
    seen.add(r.metric_key)

    const token = tokenFor(r.metric_key)
    values.push({
      token,
      value: r.value,
      display: formatMetricDisplay(r.value, r.unit),
      unit: r.unit ?? null,
    })

    if (r.delta_dod !== null && r.delta_dod !== undefined) {
      const sign = r.delta_dod >= 0 ? "+" : ""
      values.push({
        token: `${token}_DELTA_DOD`,
        value: r.delta_dod,
        display: `${sign}${round1(r.delta_dod)}%`,
        unit: "percent",
      })
    }
  }

  return { values, date_ist: opts.dateIst, one_goal: opts.oneGoal }
}

/**
 * Core orchestration (no Medusa-step wrapper, so it's directly unit/integration
 * testable with a stubbed `aiGenerate`): gather ground truth → generate → guard
 * → regenerate-once → persist BEFORE send.
 */
export async function generateIdeasEmail(
  container: any,
  opts: GenerateIdeasEmailOptions = {}
): Promise<GenerateIdeasEmailResult> {
  const aiGenerate =
    opts.aiGenerate ||
    makeRoleAiGenerate(container, IDEAS_EMAIL_ROLE, "marketing/ideas_email", {
      maxOutputTokens: 700,
    })
  const now = opts.now || new Date()
  const oneGoal =
    opts.oneGoal ||
    process.env.MARKETING_ONE_GOAL ||
    "Grow platform GMV (total sales across all stores)."
  const businessDescription =
    opts.businessDescription ||
    process.env.MARKETING_BUSINESS_DESCRIPTION ||
    DEFAULT_BUSINESS_DESCRIPTION
  const modelId = `role:${IDEAS_EMAIL_ROLE}`

  const empty: GenerateIdeasEmailResult = {
    skipped: false,
    generated: false,
    guard_passed: false,
    regenerated: false,
    log_id: null,
    output_text: "",
    model_used: modelId,
    ground_truth: null,
  }

  const marketing: any = container.resolve(MARKETING_MODULE)

  // 1) gather ground truth — latest snapshot rows, newest first.
  const rows: any[] = await marketing.listMarketingMetricSnapshots(
    {},
    { order: { captured_for_date: "DESC" }, take: 50 }
  )

  if (!rows || rows.length === 0) {
    // Don't email "₹0" with no data — abort the run (report §4.1).
    return { ...empty, skipped: true, reason: "no_snapshots" }
  }

  const dateIst = istDateString(now)
  const gt = buildGroundTruthFromSnapshots(rows, { dateIst, oneGoal })

  // 2) generate
  const prompt = buildIdeasPrompt(gt, businessDescription)
  let rawOutput = await aiGenerate(prompt)

  if (!rawOutput) {
    // AI failed: log the failure, do not send.
    const failLog = await marketing.createMarketingIdeasLogs([
      {
        generated_for_date: new Date(`${dateIst}T00:00:00.000Z`),
        model_used: modelId,
        prompt_snapshot: gt,
        output_text: "",
        guard_passed: false,
        guard_failures: [{ type: "ai_error", token: "ai_generate" }],
        regenerated: false,
        sent: false,
      },
    ])
    return {
      ...empty,
      ground_truth: gt,
      log_id: arrId(failLog),
      reason: "ai_error",
    }
  }

  // 3) guard → regenerate ONCE on failure → persist
  let verdict = runGuard(rawOutput, gt, {
    tolerancePct: opts.tolerancePct,
    allowList: opts.allowList,
  })
  let regenerated = false
  if (!verdict.passed) {
    const second = await aiGenerate(prompt + STRICTER_SUFFIX)
    regenerated = true
    if (second) {
      rawOutput = second
      verdict = runGuard(second, gt, {
        tolerancePct: opts.tolerancePct,
        allowList: opts.allowList,
      })
    }
  }

  const log = await marketing.createMarketingIdeasLogs([
    {
      generated_for_date: new Date(`${dateIst}T00:00:00.000Z`),
      model_used: modelId,
      prompt_snapshot: gt,
      output_text: verdict.finalText,
      guard_passed: verdict.passed,
      guard_failures: verdict.failures.length ? verdict.failures : null,
      regenerated,
      sent: false, // flipped true only after a successful send (PR-3)
    },
  ])

  return {
    skipped: false,
    generated: true,
    guard_passed: verdict.passed,
    regenerated,
    log_id: arrId(log),
    output_text: verdict.finalText,
    model_used: modelId,
    ground_truth: gt,
  }
}

function arrId(created: any): string | null {
  const row = Array.isArray(created) ? created[0] : created
  return row?.id ?? null
}

// ---------------------------------------------------------------------------
// Medusa workflow wrapper (injects the real OpenRouter call).
// ---------------------------------------------------------------------------
export type GenerateIdeasEmailWorkflowInput = {
  oneGoal?: string
  businessDescription?: string
}

const generateIdeasEmailStep = createStep(
  "generate-ideas-email",
  async (input: GenerateIdeasEmailWorkflowInput, { container }) => {
    const result = await generateIdeasEmail(container, {
      oneGoal: input?.oneGoal,
      businessDescription: input?.businessDescription,
    })
    return new StepResponse(result)
  }
)

export const generateIdeasEmailWorkflow = createWorkflow(
  "generate-ideas-email",
  (input: GenerateIdeasEmailWorkflowInput) => {
    const result = generateIdeasEmailStep(input)
    return new WorkflowResponse(result)
  }
)

export default generateIdeasEmailWorkflow
