/**
 * The phase a production run is in, and the one thing the partner must do next.
 *
 * #2018 — "move the action first where they see what they have to do … show
 * start only and then reveal each section". Both the pinned next-action block
 * and the phase gating read from here, so the page cannot disagree with itself
 * about which stage a run is at.
 *
 * 🔑 NOT a new status vocabulary. There are already three across two screens
 * (#2016), and a fourth would be the actual regression. Every value below is
 * derived from run state that already exists — the same timestamps the
 * `ProgressStepper` has always stepped through.
 */

/** The five stepper positions. Unchanged — the layout just never used them. */
export const RUN_STEPS = [
  { key: "received", labelKey: "partner.workOrders.steps.received" },
  { key: "accepted", labelKey: "partner.workOrders.steps.accepted" },
  { key: "started", labelKey: "partner.workOrders.steps.started" },
  { key: "finished", labelKey: "partner.workOrders.steps.finished" },
  { key: "completed", labelKey: "partner.workOrders.steps.completed" },
] as const

export type RunPhase =
  | "offered"
  | "accepted"
  | "in_production"
  | "done"
  | "cancelled"

/**
 * Which step the run has reached, 0-4, or -1 when cancelled.
 *
 * ⚠️ Timestamps FIRST, status as the fallback — lifted verbatim from the
 * stepper, including the reason: the task-completion subscriber can move
 * `status` without writing the lifecycle timestamps, so a status-first read
 * would report a run as further along than its own history shows.
 */
export const deriveRunStepIndex = (run: any): number => {
  const status = String(run?.status || "")
  if (status === "cancelled") {
    return -1
  }
  if (run?.completed_at || status === "completed") {
    return 4
  }
  if (run?.finished_at) {
    return 3
  }
  if (run?.started_at || status === "in_progress") {
    return 2
  }
  if (run?.accepted_at) {
    return 1
  }
  return 0
}

/**
 * The phase that decides what the page reveals.
 *
 * Offered shows the job and nothing else; each later phase adds to it. Earlier
 * detail stays reachable behind a collapsed affordance — hidden, never deleted.
 */
export const deriveRunPhase = (run: any): RunPhase => {
  const idx = deriveRunStepIndex(run)
  if (idx < 0) {
    return "cancelled"
  }
  if (idx === 0) {
    return "offered"
  }
  if (idx === 1) {
    return "accepted"
  }
  if (idx === 4) {
    return "done"
  }
  return "in_production"
}

export type RunActionKey = "accept" | "start" | "finish" | "complete"

/**
 * Literal key types, not `string`.
 *
 * `t()` is typed against the generated resource catalogue (`i18n/types.ts` is
 * `typeof en.json`), so a literal here is CHECKED: a key that does not exist in
 * en.json fails the build instead of rendering its own name at the top of the
 * partner's page. A `string` would compile and ship the mistake.
 */
export type RunActionLabelKey = `partner.workOrders.nextAction.${RunActionKey}`

export type RunActionDescriptionKey =
  | "partner.workOrders.nextAction.acceptHint"
  | "partner.workOrders.nextAction.startHint"
  | "partner.workOrders.nextAction.finishHint"
  | "partner.workOrders.nextAction.finishHintSample"
  | "partner.workOrders.nextAction.completeHint"
  | "partner.workOrders.nextAction.completeHintSample"

export type RunNextAction = {
  /** The partner mutation this maps to — all four already exist. */
  key: RunActionKey
  labelKey: RunActionLabelKey
  descriptionKey: RunActionDescriptionKey
}

/**
 * The single thing to put at the top of the page, or null when the ball is not
 * in the partner's court.
 *
 * 🔴 Mirrors the card's `can*` guards EXACTLY, and deliberately keys on
 * `status` rather than on the phase above. They are not the same question:
 * a run with `accepted_at` set whose status is still `sent_to_partner` is in
 * phase "accepted", but `canStart` refuses it. Deriving the button from the
 * phase would offer Start for a run the API will reject — an action that looks
 * available and then fails is worse than one that was never offered.
 *
 * Phase decides what the page REVEALS. This decides what the partner may DO.
 *
 * ⚠️ `actionable: false` must win over everything. It carries the
 * defence-in-depth guard: a partner whose design ASSIGNMENT was cancelled gets
 * no actions even if a non-cancelled run lingers (cancelling an assignment now
 * cancels the run too, but older runs predate that fix).
 */
export const getRunNextAction = (
  run: any,
  opts: { isSample?: boolean; actionable?: boolean } = {}
): RunNextAction | null => {
  if (opts.actionable === false) {
    return null
  }
  const status = String(run?.status || "")
  if (status === "cancelled") {
    return null
  }
  const suffix = opts.isSample ? ("Sample" as const) : ("" as const)

  if (status === "sent_to_partner") {
    return {
      key: "accept",
      labelKey: "partner.workOrders.nextAction.accept",
      descriptionKey: "partner.workOrders.nextAction.acceptHint",
    }
  }
  if (status === "in_progress") {
    if (!run?.started_at) {
      return {
        key: "start",
        labelKey: "partner.workOrders.nextAction.start",
        descriptionKey: "partner.workOrders.nextAction.startHint",
      }
    }
    if (!run?.finished_at) {
      return {
        key: "finish",
        labelKey: "partner.workOrders.nextAction.finish",
        descriptionKey: `partner.workOrders.nextAction.finishHint${suffix}`,
      }
    }
    return {
      key: "complete",
      labelKey: "partner.workOrders.nextAction.complete",
      descriptionKey: `partner.workOrders.nextAction.completeHint${suffix}`,
    }
  }
  return null
}

/**
 * Whether a section belongs on screen yet (#2018's reveal table).
 *
 * `cancelled` is treated as terminal-visible: the partner should still be able
 * to see what the job WAS. Hiding the spec of a cancelled run answers a
 * question nobody asked and hides one they will.
 */
export const PHASE_ORDER: RunPhase[] = [
  "offered",
  "accepted",
  "in_production",
  "done",
]

export const isPhaseAtLeast = (phase: RunPhase, min: RunPhase): boolean => {
  if (phase === "cancelled") {
    return true
  }
  return PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(min)
}
