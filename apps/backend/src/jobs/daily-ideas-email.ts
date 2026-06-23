import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  generateIdeasEmailWorkflow,
  type GenerateIdeasEmailResult,
} from "../workflows/marketing/generate-ideas-email"
import {
  sendIdeasEmailWorkflow,
  type SendIdeasEmailInput,
  type SendIdeasEmailResult,
} from "../workflows/marketing/send-ideas-email"

/**
 * daily-ideas-email — #659 slice 2, PR-4.
 *
 * The scheduled morning job that chains the two EXISTING marketing workflows:
 *   1. generate-ideas-email  → read ground-truth snapshots, ask the LLM for
 *      tactical moves, run the hallucination guard, persist a marketing_ideas_log
 *      row (BEFORE any send).
 *   2. send-ideas-email      → ONLY when the generated log passed the guard, mail
 *      the operator recipients and flip sent=true.
 *
 * Runs AFTER `marketing-daily-refresh` (snapshot cron at "0 1 * * *") so the
 * ground-truth rows exist before we generate from them — this fires at
 * "30 1 * * *" (≈ 7 AM IST).
 *
 * Operator safety / explicit opt-in:
 *   GENERATE always runs and logs (so the draft + guard verdict are persisted and
 *   reviewable in the ideas log even when nothing is mailed). SEND is gated behind
 *   the env flag `MARKETING_IDEAS_EMAIL_ENABLED` (default OFF). Set it to "true"
 *   (or "1") in prod to turn the daily email on — an explicit operator action.
 *
 * Fail-soft discipline (mirrors marketing-daily-refresh): every workflow call is
 * wrapped so a bad morning run can NEVER throw past the job boundary and crash the
 * scheduler. The orchestrator returns a summary; the default export only logs it.
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
 * Pure-ish orchestrator: chain generate → (guarded) send. The runner fns default
 * to the real workflow `.run()` calls but are INJECTABLE so tests pass stubs.
 * NEVER throws — a thrown error inside a runner is swallowed and reported in the
 * returned summary (the job must not be able to crash the scheduler).
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
  const sendable =
    summary.generated && summary.guard_passed && !!summary.log_id

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
    const sent = await send({ logId: summary.log_id as string })
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

/**
 * Scheduled-job entrypoint. Calls the orchestrator with real-workflow defaults
 * and logs a one-line summary. Never rethrows.
 */
export default async function dailyIdeasEmailJob(container: MedusaContainer) {
  let logger: any
  try {
    logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = console
  }

  const summary = await runDailyIdeasEmail(container)
  logger.info?.(
    `[daily-ideas-email] done — generated=${summary.generated} guard_passed=${summary.guard_passed} ` +
      `send_enabled=${summary.send_enabled} send_attempted=${summary.send_attempted} ` +
      `sent=${summary.sent} errored=${summary.errored}` +
      (summary.skipped_reason ? ` reason=${summary.skipped_reason}` : "")
  )
}

export const config = {
  name: "daily-ideas-email",
  // 30 min after marketing-daily-refresh ("0 1 * * *") so snapshot rows exist.
  // 1:30 AM UTC ≈ 7 AM IST.
  schedule: "30 1 * * *",
}
