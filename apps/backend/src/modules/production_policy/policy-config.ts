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

/**
 * #2202 — what to dispatch a run with when its cloth arrives and NOBODY chose.
 *
 * Templates are written in exactly one place: `approve-production-run.ts:242`,
 * per assignment, by a human. A run born `approved` from `order.placed` never
 * passes through that workflow — and it cannot, because approval mints a CHILD
 * carrying the parent's `order_line_item_id`, which collides with the partial
 * unique index `IDX_production_runs_order_line_item_active`. So such a run can
 * never carry a selection, and when its materials land it reaches
 * `releaseRunIfReady` with nothing to dispatch: one `logger.info` saying
 * "dispatch by hand", and no one told. Measured on prod 2026-09-20: 4 runs in
 * exactly that state, all on one inventory order, all due the same day.
 *
 * A default here is NOT the guess `selectDispatchInput` refuses. That refusal
 * is about a template NAME being ambiguous at dispatch time — "Stitching"
 * exists in both Pre Production and Production and they are different process
 * steps (#1261). These rules carry IDS, written ahead of time by an operator
 * who decided once for a kind of job.
 *
 * 🔴 EMPTY BY DEFAULT, and deliberately so. Dispatch is not a bookkeeping
 * write: it creates the partner's tasks, notifies them and commissions the
 * work. Until somebody writes a rule, the answer stays "tell a human".
 */
export type DispatchDefaultMatch = {
  /** 'production' | 'sample' — the same axis the run carries. */
  run_type?: string
  /** The DESIGN's product_type: robe, tea_towel, scarf, shawl, … */
  product_type?: string
}

export type DispatchDefault = {
  when: DispatchDefaultMatch
  /** Task template IDS. Names are not accepted here — see above. */
  template_ids: string[]
  /** Why this rule exists, in an operator's words. Never read by code. */
  note?: string
}

/** No rule until someone writes one. Silence beats a guess that messages a partner. */
export const DEFAULT_DISPATCH_DEFAULTS: DispatchDefault[] = []

/** The keys a `when` may constrain. A rule naming anything else is ignored. */
const MATCH_KEYS: Array<keyof DispatchDefaultMatch> = ["run_type", "product_type"]

/**
 * PURE: is this a rule we are willing to act on?
 *
 * 🔴 A MALFORMED RULE MUST NEVER DISPATCH. A typo in the settings screen that
 * quietly messaged a partner would be far worse than one that quietly did
 * nothing, so validation fails CLOSED: anything not exactly this shape is
 * treated as absent. `missingPolicyKeys` is what tells the operator their
 * section is unsaved; a malformed entry is visible there as its own absence.
 */
export const isUsableDispatchDefault = (rule: unknown): rule is DispatchDefault => {
  if (!rule || typeof rule !== "object") return false
  const r = rule as any
  const ids = Array.isArray(r.template_ids) ? r.template_ids : null
  if (!ids || !ids.length) return false
  if (!ids.every((v: unknown) => typeof v === "string" && v.length > 0)) return false
  if (!r.when || typeof r.when !== "object" || Array.isArray(r.when)) return false
  const keys = Object.keys(r.when)
  if (!keys.length) return false
  if (!keys.every((k) => (MATCH_KEYS as string[]).includes(k))) return false
  return keys.every((k) => typeof r.when[k] === "string" && r.when[k].length > 0)
}

export type DispatchSubject = {
  run_type?: string | null
  product_type?: string | null
}

/**
 * PURE: the template ids a rule set prescribes for this job, or null.
 *
 * Most specific wins — a rule naming both `run_type` and `product_type` beats
 * one naming either alone — so a general fallback and a narrow exception can
 * coexist without ordering games. Ties go to the FIRST rule written, which is
 * the operator's own order and the only tiebreak they can see.
 *
 * Every key a rule names must match. A rule is a claim about a kind of job, and
 * a partly-matching claim is not a claim about THIS job.
 */
export const resolveDispatchDefault = (
  rules: unknown,
  subject: DispatchSubject
): string[] | null => {
  const usable = (Array.isArray(rules) ? rules : []).filter(isUsableDispatchDefault)
  if (!usable.length) return null

  let best: DispatchDefault | null = null
  let bestScore = -1
  for (const rule of usable) {
    const keys = Object.keys(rule.when) as Array<keyof DispatchDefaultMatch>
    const matches = keys.every(
      (k) => String(subject?.[k] ?? "") === String(rule.when[k])
    )
    if (!matches) continue
    if (keys.length > bestScore) {
      best = rule
      bestScore = keys.length
    }
  }
  return best ? [...best.template_ids] : null
}

export const defaultPolicyConfig = (): Record<string, any> => ({
  transitions: { ...DEFAULT_TRANSITIONS },
  reassignment: { ...DEFAULT_REASSIGNMENT_POLICY },
  dispatch_defaults: [...DEFAULT_DISPATCH_DEFAULTS],
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

  /*
   * Dispatch defaults are carried through AS STORED, not filtered here.
   * `resolveDispatchDefault` is what refuses a malformed rule, and it refuses
   * at the moment of dispatch. Dropping bad entries here instead would hand the
   * settings screen a list shorter than what the operator saved, which is the
   * exact failure this file was written to end — the screen showing fewer rules
   * than are in force.
   */
  const storedDispatchDefaults = Array.isArray(cfg.dispatch_defaults)
    ? cfg.dispatch_defaults
    : [...DEFAULT_DISPATCH_DEFAULTS]

  // Carry any other top-level keys the stored config has, so this never
  // silently discards something an operator put there.
  const rest: Record<string, any> = {}
  for (const [key, value] of Object.entries(cfg)) {
    if (
      key !== "transitions" &&
      key !== "reassignment" &&
      key !== "dispatch_defaults"
    ) {
      rest[key] = value
    }
  }

  return {
    ...rest,
    transitions,
    reassignment,
    dispatch_defaults: storedDispatchDefaults,
  }
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
  /*
   * 🔴 `dispatch_defaults` is deliberately NOT reported here. This list means
   * "rules in force that your row has never heard of", and the dispatch default
   * is empty by design — an absent section enforces NOTHING. Listing it would
   * have the settings screen warn that a rule is silently in force when the
   * truth is the opposite: nothing will dispatch itself until the operator
   * writes one.
   */

  return { transitions, sections }
}
