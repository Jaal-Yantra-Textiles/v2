import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  generateIdeasEmailWorkflow,
  type GenerateIdeasEmailResult,
} from "./generate-ideas-email"
import {
  sendIdeasEmailWorkflow,
  type SendIdeasEmailInput,
  type SendIdeasEmailResult,
} from "./send-ideas-email"

/**
 * run-daily-ideas-email — #659 slice 2 orchestrator (visual-flow edition).
 *
 * Chains the two EXISTING marketing workflows for the daily tactical-ideas email:
 *   1. generate-ideas-email  → read ground-truth snapshots, ask the LLM for
 *      tactical moves, run the hallucination guard, persist a `marketing_ideas_log`
 *      row (BEFORE any send).
 *   2. send-ideas-email      → ONLY when the generated log passed the guard, mail
 *      the operator recipients and flip sent=true.
 *
 * KEY DESIGN (operator decision, #659): the SCHEDULE does NOT live in a
 * `src/jobs/*` cron file. This module is pure orchestration logic that the
 * `marketing_daily_ideas_email` visual-flow operation node calls — the cadence
 * is owned by a schedule-trigger node on an operator-editable canvas, fired by
 * `src/jobs/run-scheduled-visual-flows.ts`. There is intentionally no `config`
 * export and no default scheduled-job export here.
 *
 * Operator safety / explicit opt-in:
 *   GENERATE always runs and logs (so the draft + guard verdict are persisted and
 *   reviewable in the ideas log even when nothing is mailed). SEND is gated behind
 *   the env flag `MARKETING_IDEAS_EMAIL_ENABLED` (default OFF). Set it to "true"
 *   (or "1") in prod to turn the daily email on — an explicit operator action.
 *
 * Fail-soft discipline (mirrors `marketing-daily-refresh`): every workflow call is
 * wrapped so a bad morning run can NEVER throw past this boundary and crash the
 * visual-flow executor. The caller gets a summary object; failures are reported
 * in `errored` / `skipped_reason`, never as a thrown exception.
 */

/** Injectable generate runner — prompt+guard+persist; defaults to the real workflow. */
export type GenerateRunner = () => Promise<GenerateIdeasEmailResult>
/** Injectable send runner — mails a guarded log; defaults to the real workflow. */
export type SendRunner = (
  input: SendIdeasEmailInput
) => Promise<SendIdeasEmailResult>

export type RunDailyIdeasEmailDeps = {
  /** Injected in tests so CI NEVER calls a live LLM. */
  generate?: GenerateRunner
  /** Injected in tests so CI NEVER sends a real email. */
  send?: SendRunner
  /** Override the env send-gate (else reads MARKETING_IDEAS_EMAIL_ENABLED). */
  sendEnabled?: boolean
  /** Optional explicit recipient override forwarded to the send workflow. */
  recipients?: string[]
}

export type DailyIdeasEmailSummary = {
  generated: boolean
  guard_passed: boolean
  log_id: string | null
  send_enabled: boolean
  send_attempted: boolean
  sent: number
  skipped_reason: string | null
  errored: boolean
}

/** True only when the operator has explicitly opted in via the env flag. */
export function isSendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.MARKETING_IDEAS_EMAIL_ENABLED || "").trim().toLowerCase()
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on"
}

/**
 * Chain generate → (guarded) send. The runner fns default to the real workflow
 * `.run()` calls but are INJECTABLE so tests pass stubs. NEVER throws — a thrown
 * error inside a runner is swallowed and reported in the returned summary (the
 * operation node must not be able to crash the visual-flow executor).
 */
export async function runDailyIdeasEmail(
  container: MedusaContainer,
  deps: RunDailyIdeasEmailDeps = {}
): Promise<DailyIdeasEmailSummary> {
  let logger: any
  try {
    logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = console
  }

  const generate: GenerateRunner =
    deps.generate ||
    (async () => {
      const { result } = await generateIdeasEmailWorkflow(container as any).run({
        input: {},
      })
      return result as GenerateIdeasEmailResult
    })

  const send: SendRunner =
    deps.send ||
    (async (input: SendIdeasEmailInput) => {
      const { result } = await sendIdeasEmailWorkflow(container as any).run({
        input,
      })
      return result as SendIdeasEmailResult
    })

  const sendEnabled = deps.sendEnabled ?? isSendEnabled()

  const summary: DailyIdeasEmailSummary = {
    generated: false,
    guard_passed: false,
    log_id: null,
    send_enabled: sendEnabled,
    send_attempted: false,
    sent: 0,
    skipped_reason: null,
    errored: false,
  }

  // --- 1) GENERATE (always runs + logs; persists the draft/guard verdict) -----
  let gen: GenerateIdeasEmailResult | null = null
  try {
    gen = await generate()
  } catch (e: any) {
    summary.errored = true
    summary.skipped_reason = "generate_threw"
    logger.error?.(
      `[daily-ideas-email] generate threw (swallowed): ${e?.message ?? e}`
    )
    return summary
  }

  summary.generated = gen?.generated === true
  summary.guard_passed = gen?.guard_passed === true
  summary.log_id = gen?.log_id ?? null

  // --- 2) SEND only when: generated && guard_passed && have a log id --------
  const sendable = summary.generated && summary.guard_passed && !!summary.log_id

  if (!sendable) {
    summary.skipped_reason =
      gen?.reason ?? (gen?.skipped ? "generate_skipped" : "not_guard_passed")
    logger.info?.(
      `[daily-ideas-email] generated=${summary.generated} guard_passed=${summary.guard_passed} ` +
        `log_id=${summary.log_id ?? "none"} → send skipped (${summary.skipped_reason})`
    )
    return summary
  }

  if (!sendEnabled) {
    summary.skipped_reason = "send_disabled"
    logger.info?.(
      `[daily-ideas-email] log ${summary.log_id} guard-passed but MARKETING_IDEAS_EMAIL_ENABLED is off → not sent`
    )
    return summary
  }

  summary.send_attempted = true
  try {
    const sendInput: SendIdeasEmailInput = { logId: summary.log_id as string }
    if (Array.isArray(deps.recipients) && deps.recipients.length > 0) {
      sendInput.recipients = deps.recipients
    }
    const sent = await send(sendInput)
    summary.sent = sent?.sent ?? 0
    logger.info?.(
      `[daily-ideas-email] log ${summary.log_id} sent to ${summary.sent} recipient(s)` +
        (sent?.skipped ? ` (skipped: ${sent?.reason ?? "unknown"})` : "")
    )
  } catch (e: any) {
    summary.errored = true
    summary.skipped_reason = "send_threw"
    logger.error?.(
      `[daily-ideas-email] send threw for log ${summary.log_id} (swallowed): ${
        e?.message ?? e
      }`
    )
  }

  return summary
}
