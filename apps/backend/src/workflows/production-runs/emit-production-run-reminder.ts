import { Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { IEventBusModuleService } from "@medusajs/types"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { PRODUCTION_POLICY_MODULE } from "../../modules/production_policy"
import type ProductionPolicyService from "../../modules/production_policy/service"
import type { ReassignmentPolicy } from "../../modules/production_policy/service"
import { PARTNER_MODULE } from "../../modules/partner"
import { reassignProductionRunWorkflow } from "./reassign-production-run"
import { acceptProductionRunWorkflow } from "./accept-production-run"

export type ReminderKind =
  | "assignment_pending"
  | "not_started"
  | "idle"
  /**
   * #1279 — a run parked in `awaiting_reassignment`. Unlike every other kind
   * this one has NO partner (parking nulls `partner_id` and keeps
   * `previous_partner_id` for audit), so it is not a nag — it is an admin
   * escalation. It exists because parking used to be terminal in practice:
   * the reminder flow read only `sent_to_partner`/`in_progress`, so the moment
   * the cap parked a run, the machinery that parked it could no longer see it.
   * Six runs sat that way until a human noticed, the oldest for 4.5 months.
   */
  | "awaiting_reassignment"

export type EmitProductionRunReminderInput = {
  production_run_id: string
  /** Null only for `awaiting_reassignment` — a parked run has no partner. */
  partner_id: string | null
  design_id?: string | null
  reminder_kind: ReminderKind
}

const REMINDER_EVENT_BY_KIND: Record<ReminderKind, string> = {
  assignment_pending: "production_run.reminder_assignment_pending",
  not_started: "production_run.reminder_not_started",
  idle: "production_run.reminder_idle",
  awaiting_reassignment: "production_run.reminder_awaiting_reassignment",
}

/**
 * #1279 — how long a parked run waits between admin escalations.
 *
 * Not daily: a parked run is waiting on a human decision that takes days, and
 * a daily nag about the same six runs is how a channel gets muted. Not once
 * either — "tell someone a single time and never again" is precisely the bug
 * being fixed. Weekly is the compromise, and the escalation states how long
 * the run has been parked so the message gets more pointed rather than more
 * frequent.
 */
export const PARKED_ESCALATION_INTERVAL_DAYS = 7

/**
 * #1093 — after this many reminders in a single bucket the run stops being
 * nagged and escalates: assignment_pending → reassignment queue; an
 * already-accepted run (not_started / idle) → admin escalation.
 */
export const REMINDER_CAP = 2

type EmitAction =
  | "reminded"
  | "reassigned"
  | "escalated"
  | "skipped"
  /** #1228 — cap hit, but the partner still has retry budget left. */
  | "retried_same_partner"

type EmitStepResult = {
  action: EmitAction
  event: string | null
  reminder_count: number
  reason: string | null
}

/**
 * Pure decision: given the run's current reminder state and the classified
 * kind, decide what to do. Exported for unit testing.
 *
 *   - fresh bucket (stored kind differs) → count resets to 0
 *   - already escalated for this kind → skip (no repeat escalation)
 *   - count < CAP → send another reminder (count+1)
 *   - count >= CAP → assignment_pending reassigns; others escalate
 */
export function decideReminderAction(
  run: {
    reminder_kind?: string | null
    reminder_count?: number | null
    reminder_status?: string | null
  },
  kind: ReminderKind,
  cap: number = REMINDER_CAP
): { action: EmitAction; nextCount: number } {
  const sameBucket = run.reminder_kind === kind
  const effectiveCount = sameBucket ? run.reminder_count ?? 0 : 0

  if (sameBucket && run.reminder_status === "escalated") {
    // Already escalated on a prior run — don't nag or re-escalate.
    return { action: "skipped", nextCount: effectiveCount }
  }

  if (effectiveCount >= cap) {
    return {
      action: kind === "assignment_pending" ? "reassigned" : "escalated",
      nextCount: effectiveCount,
    }
  }

  return { action: "reminded", nextCount: effectiveCount + 1 }
}

/**
 * PURE: should a parked run escalate to an admin right now? Exported for tests.
 *
 * Deliberately NOT folded into `decideReminderAction`. That function's contract
 * — count up to a cap, then hand off — is about nagging a partner, and a parked
 * run has no partner to nag. Reusing it would have meant `reminder_status ===
 * "escalated" → skipped forever`, which recreates the original bug in a new
 * place: told once, then silent while the run sits.
 *
 * So the rule is a cadence, not a cap:
 *   - never escalated for this bucket → escalate now
 *   - escalated less than the interval ago → stay quiet
 *   - escalated longer ago than the interval → escalate again
 *
 * `parked_days` rides along so the message can sharpen over time instead of
 * repeating itself.
 */
export function decideParkedEscalation(
  run: {
    reminder_kind?: string | null
    reminder_status?: string | null
    last_reminded_at?: string | Date | null
    updated_at?: string | Date | null
  },
  now: Date = new Date(),
  intervalDays: number = PARKED_ESCALATION_INTERVAL_DAYS
): { action: "escalated" | "skipped"; parked_days: number; reason: string | null } {
  const nowMs = now.getTime()
  const asMs = (v: string | Date | null | undefined): number | null => {
    if (!v) return null
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
    return Number.isFinite(t) ? t : null
  }

  // How long it has been parked. `updated_at` is when parking last wrote the
  // row; it is an approximation, and it is the only one available without a
  // new column. Reported, never used to decide.
  const parkedSince = asMs(run.updated_at)
  const parked_days =
    parkedSince == null ? 0 : Math.max(0, Math.floor((nowMs - parkedSince) / 86_400_000))

  const alreadyInBucket = run.reminder_kind === "awaiting_reassignment"
  const lastAt = alreadyInBucket ? asMs(run.last_reminded_at) : null

  if (lastAt == null) {
    return { action: "escalated", parked_days, reason: null }
  }

  const sinceDays = (nowMs - lastAt) / 86_400_000
  if (sinceDays < intervalDays) {
    return {
      action: "skipped",
      parked_days,
      reason: "escalated_recently",
    }
  }

  return { action: "escalated", parked_days, reason: null }
}

/**
 * PURE: should a failed WhatsApp delivery un-count the reminder it carried?
 * Exported for unit testing.
 *
 * The cap counts reminders SENT, and until #1279 "sent" meant "handed to Meta",
 * not "reached anyone". Between 2026-04 and 2026-08, 132 reminders were
 * rejected outright (`131053`, an oversized design image) and every one of them
 * still incremented the count. Runs reached the cap and were parked having
 * never been asked — which is the worst possible outcome, because parking is
 * the state nothing watches.
 *
 * The send is asynchronous — the emitter increments long before Meta answers —
 * so the correction has to happen when the delivery-status webhook lands. This
 * decides whether it should.
 *
 * Conditions, all required:
 *   - the new status is `failed` (delivered/read obviously stand)
 *   - the message is NOT already `failed` — Meta can repeat a status, and the
 *     webhook re-applies `failed` by design; decrementing twice for one message
 *     would under-count and nag a partner forever
 *   - the message is a production-run REMINDER, identified by the
 *     `("production_run", "<run_id>:reminder:<date>")` context pair the reminder
 *     path writes. A failed dispatch or ad-hoc message must not touch the cap.
 */
export function planReminderRollback(
  message: {
    status?: string | null
    context_type?: string | null
    context_id?: string | null
  },
  newStatus: string
): { production_run_id: string } | null {
  if (newStatus !== "failed" || message?.status === "failed") {
    return null
  }
  if (message?.context_type !== "production_run" || !message?.context_id) {
    return null
  }
  if (!message.context_id.includes(":reminder:")) {
    return null
  }

  const runId = message.context_id.split(":")[0]
  return runId ? { production_run_id: runId } : null
}

/**
 * #1228 — what a cap on an UNACCEPTED run does. Before #1228 this was always
 * "park it"; now the stored policy may buy the partner one more full reminder
 * cycle first, on the theory that a silent partner is usually a busy one rather
 * than an absent one. `same_partner_retries: 0` restores the old behaviour.
 *
 * Pure — exported for unit testing.
 */
export function decideCapOutcome(
  run: { reassign_retry_count?: number | null },
  policy: Pick<ReassignmentPolicy, "same_partner_retries">
): { outcome: "retry_same_partner" | "park"; nextRetryCount: number } {
  const spent = run.reassign_retry_count ?? 0
  const budget = policy.same_partner_retries ?? 0

  if (spent < budget) {
    return { outcome: "retry_same_partner", nextRetryCount: spent + 1 }
  }
  return { outcome: "park", nextRetryCount: spent }
}

const processReminderStep = createStep(
  "process-production-run-reminder",
  async (input: EmitProductionRunReminderInput, { container }) => {
    const eventName = REMINDER_EVENT_BY_KIND[input.reminder_kind]
    if (!eventName) {
      return new StepResponse<EmitStepResult>({
        action: "skipped",
        event: null,
        reminder_count: 0,
        reason: "unknown_reminder_kind",
      })
    }
    // A parked run legitimately has no partner — that is the whole point of the
    // bucket. Every other kind still requires one.
    const isParked = input.reminder_kind === "awaiting_reassignment"
    if (!input.production_run_id || (!input.partner_id && !isParked)) {
      return new StepResponse<EmitStepResult>({
        action: "skipped",
        event: eventName,
        reminder_count: 0,
        reason: "missing_required_ids",
      })
    }

    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const run = (await service
      .retrieveProductionRun(input.production_run_id)
      .catch(() => null)) as any
    if (!run) {
      return new StepResponse<EmitStepResult>({
        action: "skipped",
        event: eventName,
        reminder_count: 0,
        reason: "run_not_found",
      })
    }

    const eventService = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService

    // ── #1279: parked runs escalate to an admin on a cadence ─────────────────
    // Handled before the partner buckets because none of that logic applies:
    // there is nobody to nag, and the cap must not silence this.
    if (isParked) {
      const parked = decideParkedEscalation(run)

      if (parked.action === "skipped") {
        return new StepResponse<EmitStepResult>({
          action: "skipped",
          event: eventName,
          reminder_count: run.reminder_count ?? 0,
          reason: parked.reason,
        })
      }

      await eventService.emit([
        {
          name: eventName,
          data: {
            production_run_id: input.production_run_id,
            // Who it came FROM. A parked run has no current partner, and an
            // admin's first question is always "who dropped it".
            previous_partner_id: run.previous_partner_id ?? null,
            design_id: input.design_id ?? run.design_id ?? null,
            reminder_kind: input.reminder_kind,
            parked_days: parked.parked_days,
          },
        },
      ])

      await service.updateProductionRuns({
        id: input.production_run_id,
        reminder_kind: input.reminder_kind,
        reminder_status: "escalated",
        // Doubles as "when we last told an admin" — the cadence reads it back.
        last_reminded_at: new Date(),
      })

      return new StepResponse<EmitStepResult>({
        action: "escalated",
        event: eventName,
        reminder_count: run.reminder_count ?? 0,
        reason: null,
      })
    }

    // Past the parked branch every kind is partner-facing, and the guard above
    // already returned when a partner was missing. Narrow for the type system.
    const partnerId = input.partner_id as string

    const { action, nextCount } = decideReminderAction(run, input.reminder_kind)

    if (action === "skipped") {
      return new StepResponse<EmitStepResult>({
        action,
        event: eventName,
        reminder_count: nextCount,
        reason: "already_escalated",
      })
    }

    if (action === "reminded") {
      await eventService.emit([
        {
          name: eventName,
          data: {
            production_run_id: input.production_run_id,
            partner_id: partnerId,
            design_id: input.design_id ?? null,
            reminder_kind: input.reminder_kind,
            reminder_count: nextCount,
          },
        },
      ])
      await service.updateProductionRuns({
        id: input.production_run_id,
        reminder_count: nextCount,
        reminder_kind: input.reminder_kind,
        reminder_status: "active",
        last_reminded_at: new Date(),
      })
      return new StepResponse<EmitStepResult>({
        action,
        event: eventName,
        reminder_count: nextCount,
        reason: null,
      })
    }

    if (action === "reassigned") {
      // Cap hit on an unaccepted run. #1228 — before giving the work to
      // someone else, the policy may buy this partner one more reminder cycle.
      const policyService: ProductionPolicyService = container.resolve(
        PRODUCTION_POLICY_MODULE
      )
      const reassignmentPolicy = await policyService.getReassignmentPolicy()
      const { outcome, nextRetryCount } = decideCapOutcome(run, reassignmentPolicy)

      if (outcome === "retry_same_partner") {
        // Keep the partner and the status; just restart the reminder cycle and
        // spend a retry. The next cap on this run will park it.
        await service.updateProductionRuns({
          id: input.production_run_id,
          reassign_retry_count: nextRetryCount,
          reminder_count: 0,
          reminder_kind: null,
          reminder_status: null,
        })

        await eventService.emit([
          {
            name: "production_run.reminder_retried_same_partner",
            data: {
              production_run_id: input.production_run_id,
              partner_id: partnerId,
              design_id: input.design_id ?? null,
              reminder_kind: input.reminder_kind,
              retry_count: nextRetryCount,
            },
          },
        ])

        // Optional escape hatch: a partner who has pre-agreed to it gets the
        // run accepted on their behalf, so production moves instead of waiting
        // on a click that history says isn't coming. Both the policy AND the
        // partner's own opt-in must be true, and only ever on a retry.
        //
        // 🔑 THIS IS THE ONLY PLACE ANYTHING AUTO-ACCEPTS, and it is reached
        // only from the reminder RETRY path. A first dispatch always waits for
        // a human click — by design, reaffirmed in #1575: the partner setting
        // reads "Accept re-sent runs for me" and says in as many words that a
        // first dispatch is never auto-accepted.
        //
        // ⚠️ So "auto-accept is on and nothing happens" is EXPECTED on a fresh
        // dispatch, and is not evidence that either flag is off. #1575 was
        // opened on exactly that reading, and a stale comment in
        // `api/partners/details/route.ts` claiming the prod gate was off sent
        // the first investigation the wrong way. Check which PATH you are on
        // before you check the flags.
        let autoAccepted = false
        if (reassignmentPolicy.auto_accept_on_retry && run.status === "sent_to_partner") {
          const partnerService: any = container.resolve(PARTNER_MODULE)
          const partner = await partnerService
            .retrievePartner(partnerId)
            .catch(() => null)

          if (partner?.auto_accept_production_runs) {
            await acceptProductionRunWorkflow(container)
              .run({
                input: {
                  production_run_id: input.production_run_id,
                  partner_id: partnerId,
                },
              })
              .then(() => {
                autoAccepted = true
              })
              .catch(() => {
                /* non-fatal — the retry itself already stands */
              })
          }
        }

        return new StepResponse<EmitStepResult>({
          action: "retried_same_partner",
          event: "production_run.reminder_retried_same_partner",
          reminder_count: 0,
          reason: autoAccepted ? "auto_accepted" : null,
        })
      }

      // Retry budget spent → send it to the reassignment queue.
      await reassignProductionRunWorkflow(container).run({
        input: {
          production_run_id: input.production_run_id,
          partner_id: partnerId,
          source: "reminder_cap",
          reason: "reminder_cap_reached",
          composed_reason: `Auto-reassigned: no response after ${REMINDER_CAP} reminders`,
        },
      })
      return new StepResponse<EmitStepResult>({
        action,
        event: "production_run.reassignment_needed",
        reminder_count: nextCount,
        reason: null,
      })
    }

    // action === "escalated" — accepted run gone quiet past the cap. Flag for
    // admin follow-up (no reassignment — the partner still holds the work).
    await eventService.emit([
      {
        name: "production_run.reminder_escalated",
        data: {
          production_run_id: input.production_run_id,
          partner_id: partnerId,
          design_id: input.design_id ?? null,
          reminder_kind: input.reminder_kind,
          reminder_count: nextCount,
        },
      },
    ])
    await service.updateProductionRuns({
      id: input.production_run_id,
      reminder_kind: input.reminder_kind,
      reminder_status: "escalated",
    })
    return new StepResponse<EmitStepResult>({
      action,
      event: "production_run.reminder_escalated",
      reminder_count: nextCount,
      reason: null,
    })
  }
)

export const emitProductionRunReminderWorkflow = createWorkflow(
  "emit-production-run-reminder",
  (input: EmitProductionRunReminderInput) => {
    const result = processReminderStep(input)
    return new WorkflowResponse(result)
  }
)

export default emitProductionRunReminderWorkflow
