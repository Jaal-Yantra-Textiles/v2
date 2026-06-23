import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables } from "./utils"
import {
  runDailyIdeasEmail,
  isSendEnabled,
  type RunDailyIdeasEmailDeps,
} from "../../../workflows/marketing/run-daily-ideas-email"

/**
 * marketing_daily_ideas_email — #659 slice 2, visual-flow edition.
 *
 * A single operation node that runs the daily AI-VP-of-Marketing tactical-ideas
 * email end to end by chaining the two EXISTING marketing workflows (it does NOT
 * duplicate that logic — see `run-daily-ideas-email.ts`):
 *   1. generate-ideas-email → reads ground-truth snapshots, prompts the LLM,
 *      runs the hallucination guard, persists a `marketing_ideas_log` row.
 *   2. send-ideas-email → ONLY when `generated && guard_passed && log_id` AND
 *      the send gate is on → mails the operator recipients and flips sent=true.
 *
 * WHY A FLOW NODE (not a `src/jobs/*` cron): the operator owns the cadence. This
 * node sits behind a schedule-trigger node on an editable canvas; the schedule is
 * parsed and fired by `src/jobs/run-scheduled-visual-flows.ts`. Suggested cadence:
 * "30 1 * * *" (≈ 7 AM IST) — AFTER `marketing-daily-refresh` ("0 1 * * *") so the
 * snapshot rows exist. The operator can retime it from the canvas; no redeploy.
 *
 * OPERATOR SAFETY / explicit opt-in:
 *   GENERATE always runs and logs (the draft + guard verdict are persisted and
 *   reviewable even when nothing is mailed). SEND is OFF by default and only fires
 *   when EITHER the node option `send_enabled: true` is set OR the env flag
 *   `MARKETING_IDEAS_EMAIL_ENABLED` is truthy. Default OFF in prod.
 *
 * NEVER throws past the workflow boundary: the orchestrator swallows runner
 * errors and reports them in the summary; `execute` additionally try/catches so a
 * config error returns `success:false` rather than crashing the executor.
 *
 * Node output (the summary): { generated, guard_passed, log_id, send_enabled,
 *   send_attempted, sent, skipped_reason, errored }.
 */

export const marketingDailyIdeasEmailOptionsSchema = z.object({
  /**
   * Enable the SEND step from the canvas. When omitted/undefined the env flag
   * `MARKETING_IDEAS_EMAIL_ENABLED` decides (default OFF). When set, this
   * explicit value wins. Accepts a `{{ variable }}` string that resolves to a
   * boolean-ish value too.
   */
  send_enabled: z.union([z.boolean(), z.string()]).optional(),
  /**
   * Optional explicit recipient override (array, or a `{{ variable }}` string
   * resolving to one). When unset, the send workflow falls back to its CSV env /
   * platform-admin recipients.
   */
  recipients: z.union([z.array(z.string()), z.string()]).optional(),
})

export type MarketingDailyIdeasEmailOptions = z.infer<
  typeof marketingDailyIdeasEmailOptionsSchema
>

/**
 * Coerce a resolved `send_enabled` option into a tri-state:
 *   - `undefined` → caller falls back to the env gate
 *   - `true`/`false` → explicit override
 * Pure so it's unit-testable. Mirrors `isSendEnabled`'s truthy vocabulary for
 * strings ("true"/"1"/"yes"/"on" → true; "false"/"0"/"no"/"off" → false).
 */
export function resolveSendEnabledOption(
  value: unknown
): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value === "boolean") return value
  const raw = String(value).trim().toLowerCase()
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") {
    return false
  }
  return undefined
}

/** Normalize a resolved `recipients` option into a clean string[] (or undefined). */
export function normalizeRecipientsOption(
  value: unknown
): string[] | undefined {
  let list: unknown[] | null = null
  if (Array.isArray(value)) {
    list = value
  } else if (typeof value === "string" && value.trim()) {
    // Allow a CSV string for the canvas convenience.
    list = value.split(",")
  }
  if (!list) return undefined
  const out = list
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0)
  return out.length > 0 ? out : undefined
}

export const marketingDailyIdeasEmailOperation: OperationDefinition = {
  type: "marketing_daily_ideas_email",
  name: "Marketing Daily Ideas Email",
  description:
    "Run the daily AI tactical-ideas email: generate (LLM + hallucination guard + persist a marketing_ideas_log), then send only when guard-passed AND enabled. Pair with a schedule-trigger node to run it every morning. Send is OFF unless send_enabled or MARKETING_IDEAS_EMAIL_ENABLED is set.",
  icon: "envelope",
  category: "communication",
  optionsSchema: marketingDailyIdeasEmailOptionsSchema,

  defaultOptions: {},

  execute: async (
    options: any,
    context: OperationContext
  ): Promise<OperationResult> => {
    try {
      const parsed = marketingDailyIdeasEmailOptionsSchema.parse(options ?? {})

      // Resolve {{ variable }} references BEFORE interpreting the values
      // (reference_visual_flow_template_items_resolution: interpolate string
      // options before any type-narrowing checks).
      const resolvedSendEnabled =
        parsed.send_enabled !== undefined
          ? interpolateVariables(parsed.send_enabled, context.dataChain)
          : undefined
      const resolvedRecipients =
        parsed.recipients !== undefined
          ? interpolateVariables(parsed.recipients, context.dataChain)
          : undefined

      const deps: RunDailyIdeasEmailDeps = {}
      const sendOverride = resolveSendEnabledOption(resolvedSendEnabled)
      if (sendOverride !== undefined) {
        deps.sendEnabled = sendOverride
      }
      const recipients = normalizeRecipientsOption(resolvedRecipients)
      if (recipients) {
        deps.recipients = recipients
      }

      const summary = await runDailyIdeasEmail(context.container, deps)

      return {
        success: true,
        data: {
          ...summary,
          // Convenience scalar so a downstream condition node can branch on it.
          mailed: summary.sent > 0,
        },
      }
    } catch (error: any) {
      // The orchestrator never throws; this guards only config/parse errors.
      return {
        success: false,
        error: error?.message ?? "Failed to run daily ideas email",
        errorStack: error?.stack,
      }
    }
  },
}

// Re-export so a flow/seed can read the env-only default without importing the lib.
export { isSendEnabled }
