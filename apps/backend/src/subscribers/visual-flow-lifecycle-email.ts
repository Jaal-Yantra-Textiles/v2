import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendNotificationEmailWorkflow } from "../workflows/email"

/**
 * Subscriber: visual_flow_execution.{started,failed} → admin email
 *
 * Why this exists (roadmap item 26): when a visual-flow execution
 * errored before this PR, it landed as `status=failed` (or `cancelled`
 * at the wrapping workflow layer) with the generic message
 * "Workflow cancelled during execution" and silence. The bug-25c
 * diagnosis took three days because nobody knew the WhatsApp send had
 * been rejected by Meta. Hooking a notification at start + on failure
 * gives admins a paper trail and an in-inbox surface for diagnosis.
 *
 * Recipient resolution (first non-empty wins):
 *   1. `flow.metadata.failure_email` (per-flow override, set in admin
 *      UI without a deploy)
 *   2. `process.env.VISUAL_FLOW_FAILURE_EMAIL` (platform default)
 *   3. bail silently (logged) — we never want this subscriber to be
 *      the reason an execution fails
 *
 * Throttle: an in-memory dedup window keyed by
 *   - started: `started:<flow_id>`
 *   - failed:  `failed:<flow_id>:<first 60 chars of error message>`
 * suppresses duplicates within `THROTTLE_MS`. This is per-process; in a
 * multi-worker deploy each worker will send at most one email per
 * window, which is acceptable noise (1-2 emails per fanout burst, not
 * 100). Redis-backed dedup is a follow-up if the per-worker emails
 * become a real problem.
 */

const THROTTLE_MS = 10 * 60 * 1000

// Module-scoped so it survives across subscriber invocations within
// the same node process. Reset on deploy, which is the right TTL floor
// anyway — a fresh deploy is a legitimate reason to re-page admins.
const lastSentAt = new Map<string, number>()

function shouldThrottle(key: string, now: number): boolean {
  const prev = lastSentAt.get(key)
  if (prev && now - prev < THROTTLE_MS) {
    return true
  }
  lastSentAt.set(key, now)
  // Opportunistic cleanup so the Map doesn't grow unbounded over the
  // lifetime of the process. Cheap because we already paid for the
  // iteration cost on the same hot path.
  if (lastSentAt.size > 500) {
    for (const [k, ts] of lastSentAt) {
      if (now - ts > THROTTLE_MS) lastSentAt.delete(k)
    }
  }
  return false
}

// Recipient resolution (first non-empty wins):
//   1. flow.metadata.failure_email  — per-flow override, set in admin UI
//   2. VISUAL_FLOW_FAILURE_EMAIL     — platform default (set in prod SSM)
//   3. MAILJET_FROM_EMAIL            — last-resort floor so a failure alert
//      never silently no-ops. The 401 incident (#32B) paged nobody precisely
//      because (1) and (2) were both unset and the subscriber bailed at debug
//      level. The from-address is an inbox the team controls, so it's a
//      sane catch-all until VISUAL_FLOW_FAILURE_EMAIL is configured.
function resolveRecipient(data: any): { email: string; source: string } | null {
  const fromMetadata = data?.flow_metadata?.failure_email
  if (typeof fromMetadata === "string" && fromMetadata.includes("@")) {
    return { email: fromMetadata, source: "flow.metadata.failure_email" }
  }
  const fromEnv = process.env.VISUAL_FLOW_FAILURE_EMAIL
  if (fromEnv && fromEnv.includes("@")) {
    return { email: fromEnv, source: "VISUAL_FLOW_FAILURE_EMAIL" }
  }
  const fallback = process.env.MAILJET_FROM_EMAIL
  if (fallback && fallback.includes("@")) {
    return { email: fallback, source: "MAILJET_FROM_EMAIL (fallback)" }
  }
  return null
}

// Whether to send the "flow started" email for this execution (#418).
// The start email (roadmap 26) gives long-running flows a kick-off signal,
// but short-interval *scheduled* flows turned it into inbox spam. Decision:
//   1. flow.metadata.send_start_email — explicit per-flow toggle (admin UI).
//      Accepts a real boolean or the "true"/"false" strings the key-value
//      metadata editor produces.
//   2. default — OFF for schedule-triggered flows, ON for every other
//      trigger type (event/manual/webhook/another_flow keep the paper trail).
// Failure/cancelled emails are intentionally NOT gated by this — a flow that
// silences its start notice still alerts on failure.
function shouldSendStartEmail(data: any): boolean {
  const explicit = data?.flow_metadata?.send_start_email
  if (typeof explicit === "boolean") return explicit
  if (explicit === "true") return true
  if (explicit === "false") return false
  return data?.flow_trigger_type !== "schedule"
}

function buildExecutionUrl(executionId: string): string | undefined {
  const adminBase =
    process.env.ADMIN_BASE_URL ||
    process.env.MEDUSA_ADMIN_BACKEND_URL ||
    process.env.BACKEND_URL
  if (!adminBase) return undefined
  return `${adminBase.replace(/\/$/, "")}/app/visual-flows/executions/${executionId}`
}

// Normalize the message so transient identifiers (ULIDs, UUIDs,
// timestamps, numeric IDs) don't make every fingerprint unique and
// bypass the throttle. ULIDs are 26-char Crockford base32 — that's
// alphanumeric, not hex — so a hex-only regex misses every Medusa ID
// we'd actually want to collapse.
function fingerprint(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-z]{12,}/g, "*")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
}

export default async function visualFlowLifecycleEmailHandler({
  event,
  container,
}: SubscriberArgs<Record<string, any>>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const data = event.data || {}
  const eventName = event.name

  const resolved = resolveRecipient(data)
  if (!resolved) {
    // WARN, not debug: a no-recipient bail is exactly how the 401 incident
    // (#32B) paged nobody. Make the silent skip visible in logs/alerting.
    logger.warn(
      `[visual-flow-lifecycle-email] ${eventName}: NO RECIPIENT configured ` +
        `(flow.metadata.failure_email + VISUAL_FLOW_FAILURE_EMAIL + MAILJET_FROM_EMAIL ` +
        `all empty) — failure alert dropped. Set VISUAL_FLOW_FAILURE_EMAIL in prod.`
    )
    return
  }
  const recipient = resolved.email

  const flowId = data.flow_id || "unknown"
  const flowName = data.flow_name || flowId
  const executionId = data.execution_id || "unknown"
  const executionUrl = buildExecutionUrl(executionId)
  const now = Date.now()

  if (eventName === "visual_flow_execution.started") {
    if (!shouldSendStartEmail(data)) {
      logger.debug(
        `[visual-flow-lifecycle-email] start email disabled for flow=${flowId} ` +
          `(send_start_email=${data?.flow_metadata?.send_start_email ?? "unset"}, ` +
          `trigger_type=${data?.flow_trigger_type ?? "unknown"})`
      )
      return
    }
    if (shouldThrottle(`started:${flowId}`, now)) {
      logger.debug(
        `[visual-flow-lifecycle-email] throttled start email for ${flowId}`
      )
      return
    }
    try {
      await sendNotificationEmailWorkflow(container).run({
        input: {
          to: recipient,
          template: "visual-flow-started",
          data: {
            flow_name: flowName,
            execution_id: executionId,
            triggered_by: data.triggered_by ?? null,
            triggered_by_event: data.triggered_by_event ?? null,
            started_at: data.started_at ?? new Date().toISOString(),
            execution_url: executionUrl ?? null,
          },
        },
      })
      logger.info(
        `[visual-flow-lifecycle-email] sent started email for flow=${flowId} execution=${executionId}`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : JSON.stringify(err)
      logger.error(
        `[visual-flow-lifecycle-email] failed to send started email: ${message}`
      )
    }
    return
  }

  // Both terminal-failure shapes alert identically (#32B, user-requested
  // "email on fail AND cancelled"): the workflow rollback ends a run as
  // `cancelled` while the engine path marks `failed`, and either means the
  // flow didn't complete. Treat them the same so neither slips through.
  if (
    eventName === "visual_flow_execution.failed" ||
    eventName === "visual_flow_execution.cancelled"
  ) {
    const status = eventName === "visual_flow_execution.cancelled" ? "cancelled" : "failed"
    const errMsg = data.error_message || "Unknown error"
    // Fingerprint is keyed by status too so a flow that emits both shapes
    // doesn't suppress the second behind the first.
    const fp = `${status}:${flowId}:${fingerprint(errMsg)}`
    if (shouldThrottle(fp, now)) {
      logger.debug(
        `[visual-flow-lifecycle-email] throttled ${status} email for ${flowId} (fingerprint=${fp})`
      )
      return
    }
    try {
      await sendNotificationEmailWorkflow(container).run({
        input: {
          to: recipient,
          template: "visual-flow-failure",
          data: {
            flow_name: flowName,
            execution_id: executionId,
            status,
            failing_operation_key: data.failing_operation_key ?? null,
            error_message: errMsg,
            triggered_by: data.triggered_by ?? null,
            triggered_by_event: data.triggered_by_event ?? null,
            failed_at: data.failed_at ?? new Date().toISOString(),
            execution_url: executionUrl ?? null,
          },
        },
      })
      logger.info(
        `[visual-flow-lifecycle-email] sent ${status} email to ${recipient} ` +
          `(via ${resolved.source}) for flow=${flowId} execution=${executionId}`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : JSON.stringify(err)
      logger.error(
        `[visual-flow-lifecycle-email] failed to send ${status} email: ${message}`
      )
    }
  }
}

export const config: SubscriberConfig = {
  event: [
    "visual_flow_execution.started",
    "visual_flow_execution.failed",
    "visual_flow_execution.cancelled",
  ],
}

// Exposed for the integration test so it can reset throttle state
// between cases. Intentionally not part of the production import path.
export const __testing = {
  clearThrottle: () => lastSentAt.clear(),
  fingerprint,
  resolveRecipient,
  shouldSendStartEmail,
}
