/**
 * The production-run policy's shape, its defaults, and how a stored config is
 * reconciled with them.
 *
 * Why this exists: the stored policy row is seeded with defaults exactly once,
 * at creation, and every key added to the policy since then has never reached
 * it. Prod's row (created long before `start_work_from`, `decline_from`,
 * `assign_partner_from` or `reassignment` existed) carries 4 of the 9
 * transition keys and no reassignment block at all.
 *
 * Nothing broke, because every read falls back per key — which is precisely why
 * it went unnoticed for so long. What DID break is the operator's view: the
 * settings screen renders the stored config, so it presents "the rules that
 * gate approve, dispatch and accept" while showing fewer than half of them, and
 * the reassignment switch reads a key that isn't there.
 *
 * These helpers are pure so the reconciliation can be tested without a DB.
 */

/** #1228 — what the reminder cap does before parking a run for reassignment. */
export type ReassignmentPolicy = {
  same_partner_retries: number
  auto_accept_on_retry: boolean
}

export const DEFAULT_REASSIGNMENT_POLICY: ReassignmentPolicy = {
  same_partner_retries: 1,
  auto_accept_on_retry: false,
}

/** Every transition key the policy understands, and the statuses each allows. */
export const DEFAULT_TRANSITIONS: Record<string, string[]> = {
  approve_from: ["draft", "pending_review"],
  dispatch_from: ["approved"],
  send_to_production_from: ["approved"],
  accept_from: ["sent_to_partner"],
  // Partner work lifecycle. Accepting moves the run to in_progress; start/
  // finish/complete then stage within it via the lifecycle timestamps.
  start_work_from: ["in_progress"],
  finish_work_from: ["in_progress"],
  complete_work_from: ["in_progress"],
  decline_from: [
    "draft",
    "pending_review",
    "approved",
    "sent_to_partner",
    "in_progress",
  ],
  // #1228 — manual (re)assignment, deliberately separate from dispatch_from.
  assign_partner_from: [
    "awaiting_reassignment",
    "draft",
    "pending_review",
    "approved",
    "sent_to_partner",
  ],
}

export const defaultPolicyConfig = (): Record<string, any> => ({
  transitions: { ...DEFAULT_TRANSITIONS },
  reassignment: { ...DEFAULT_REASSIGNMENT_POLICY },
})

/**
 * PURE: the config that actually governs the system — defaults with the stored
 * config layered on top, key by key.
 *
 * Merged rather than replaced so that a row missing newer keys still reports
 * the rules those keys enforce. A stored key always wins, including one whose
 * value is an empty array: "no status may do this" is a legitimate policy and
 * must not silently revert to the default.
 */
export const mergePolicyConfig = (
  stored: Record<string, any> | null | undefined
): Record<string, any> => {
  const defaults = defaultPolicyConfig()
  const cfg = stored || {}

  const storedTransitions = (cfg.transitions || {}) as Record<string, any>
  const transitions: Record<string, any> = { ...defaults.transitions }
  for (const [key, value] of Object.entries(storedTransitions)) {
    // Keep unknown keys: an operator may be staging a rename, and dropping
    // their edit silently would be worse than carrying a key nothing reads.
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      transitions[key] = value
    } else if (!(key in transitions)) {
      transitions[key] = value
    }
  }

  const storedReassignment = (cfg.reassignment || {}) as Record<string, any>
  const retries = Number(storedReassignment.same_partner_retries)
  const reassignment: ReassignmentPolicy = {
    same_partner_retries:
      Number.isFinite(retries) && retries >= 0
        ? Math.floor(retries)
        : DEFAULT_REASSIGNMENT_POLICY.same_partner_retries,
    auto_accept_on_retry:
      typeof storedReassignment.auto_accept_on_retry === "boolean"
        ? storedReassignment.auto_accept_on_retry
        : DEFAULT_REASSIGNMENT_POLICY.auto_accept_on_retry,
  }

  // Carry any other top-level keys the stored config has, so this never
  // silently discards something an operator put there.
  const rest: Record<string, any> = {}
  for (const [key, value] of Object.entries(cfg)) {
    if (key !== "transitions" && key !== "reassignment") rest[key] = value
  }

  return { ...rest, transitions, reassignment }
}

/**
 * PURE: which parts of the policy are running on defaults because the stored
 * row has never heard of them.
 *
 * Surfaced to the operator so the settings screen can say "these 6 rules are in
 * force but not saved" instead of quietly omitting them — the omission is what
 * made the inert reassignment switch look like a UI bug rather than a missing
 * key.
 */
export const missingPolicyKeys = (
  stored: Record<string, any> | null | undefined
): { transitions: string[]; sections: string[] } => {
  const cfg = stored || {}
  const storedTransitions = (cfg.transitions || {}) as Record<string, any>

  const transitions = Object.keys(DEFAULT_TRANSITIONS).filter(
    (k) => !(k in storedTransitions)
  )
  const sections: string[] = []
  if (!cfg.transitions) sections.push("transitions")
  if (!cfg.reassignment) sections.push("reassignment")

  return { transitions, sections }
}
