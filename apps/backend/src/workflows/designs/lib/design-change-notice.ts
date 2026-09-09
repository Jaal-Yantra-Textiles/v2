/**
 * #1918 — what to tell a customer when the designs on their order change.
 *
 * PURE: no container, no I/O. Given a line item's production run (or its
 * absence), it decides what is TRUE about that garment and what the customer
 * should be told. Pure because the whole value here is the honesty of the
 * mapping, and that deserves tests that cannot be faked by a stubbed container.
 *
 * ## Why the reassurance has to be earned
 *
 * The ask was: if runs are found, reassure the customer — "don't worry, the
 * designs are produced, this is just our system letting you know." That is the
 * right message for a garment already made. It is a FALSE message for a garment
 * nobody has started, and the difference is invisible from the order.
 *
 * Aline's order is the worked example (#1918): 5 design items, €335 captured,
 * and exactly ONE production run — for the skirt that already shipped. Four
 * garments are owed with no run at all. A blanket "your designs are produced"
 * would tell someone owed four garments that they are finished.
 *
 * So the reassurance keys on the run's ACTUAL state, and the no-run case gets
 * its own wording rather than borrowing the comfortable one.
 */

/** Run statuses, as `production_runs.status` actually spells them. */
export type RunStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "sent_to_partner"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "awaiting_reassignment"

export type RunLike = {
  id?: string | null
  status?: string | null
  produced_quantity?: number | string | null
} | null

/**
 * What is true about the garment behind a line item.
 *
 * `made` and `being_made` are the two states that earn the reassuring wording.
 * `not_started` explicitly does not — it is the state four of Aline's five
 * items are in.
 */
export type ProductionState = "made" | "being_made" | "queued" | "not_started"

export const PRODUCTION_STATE_LABELS: Record<ProductionState, string> = {
  made: "already made",
  being_made: "being made now",
  queued: "queued for production",
  not_started: "not started yet",
}

/** The states where "don't worry, it's in hand" is a true thing to say. */
export function isReassuring(state: ProductionState): boolean {
  return state === "made" || state === "being_made"
}

/**
 * PURE: read a produced quantity without letting absence become zero.
 *
 * `produced_quantity` is null on runs that genuinely produced goods — 12 parent
 * runs in prod needed a backfill for exactly this. So a null here means "not
 * recorded", NOT "produced nothing", and must never be rendered as a quantity.
 */
export function readProducedQuantity(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" && value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * PURE: the garment's state, from its run.
 *
 * 🔴 `completed` alone means made. It deliberately does NOT also require
 * `produced_quantity > 0`: that field is null on runs that really did produce
 * goods, so requiring it would tell a customer their finished garment was never
 * started. The quantity is reported only when it is actually recorded.
 *
 * 🔴 `cancelled` is NOT production. A cancelled run is the strongest evidence
 * that nothing is being made, so it maps to `not_started` rather than being
 * treated as "a run exists, therefore reassure".
 */
export function productionStateOf(run: RunLike): ProductionState {
  if (!run || !run.status) return "not_started"
  switch (String(run.status) as RunStatus) {
    case "completed":
      return "made"
    case "in_progress":
    case "sent_to_partner":
      return "being_made"
    case "approved":
    case "pending_review":
    case "draft":
    case "awaiting_reassignment":
      return "queued"
    case "cancelled":
      return "not_started"
    default:
      // An unrecognised status is not evidence of production. Fail toward the
      // claim that promises the customer the least.
      return "not_started"
  }
}

export type DesignChange = {
  line_item_id: string
  item_title: string | null
  /** The design the item pointed at before, if any. */
  previous_design: { id: string; name: string | null } | null
  /** The design it points at now. `null` means it was DETACHED. */
  new_design: { id: string; name: string | null } | null
  run: RunLike
}

export type ChangeLine = {
  line_item_id: string
  item_title: string | null
  action: "attached" | "detached" | "replaced" | "unchanged"
  previous_design_name: string | null
  new_design_name: string | null
  production_state: ProductionState
  production_label: string
  produced_quantity: number | null
  reassuring: boolean
}

/** PURE: name the change so the email does not have to infer it from nulls. */
export function actionOf(change: DesignChange): ChangeLine["action"] {
  const prev = change.previous_design?.id ?? null
  const next = change.new_design?.id ?? null
  if (prev === next) return "unchanged"
  if (!prev && next) return "attached"
  if (prev && !next) return "detached"
  return "replaced"
}

/** PURE: one row of the customer's "what changed" table. */
export function buildChangeLine(change: DesignChange): ChangeLine {
  const state = productionStateOf(change.run)
  return {
    line_item_id: change.line_item_id,
    item_title: change.item_title ?? null,
    action: actionOf(change),
    previous_design_name: change.previous_design?.name ?? null,
    new_design_name: change.new_design?.name ?? null,
    production_state: state,
    production_label: PRODUCTION_STATE_LABELS[state],
    produced_quantity: readProducedQuantity(change.run?.produced_quantity),
    reassuring: isReassuring(state),
  }
}

export type DesignChangeNotice = {
  lines: ChangeLine[]
  /** Only the lines that actually changed — an unchanged row is not news. */
  changed_lines: ChangeLine[]
  /** True when EVERY changed garment is made or being made. */
  all_in_hand: boolean
  /** True when at least one changed garment has no production behind it. */
  any_not_started: boolean
  /** The single sentence the email leads with. */
  headline: string
  /** Whether there is anything worth emailing about at all. */
  should_send: boolean
}

/**
 * PURE: assemble the notice.
 *
 * The headline is chosen from the WEAKEST claim the evidence supports, not the
 * strongest. If any changed garment has no run, the customer is not told that
 * everything is in hand — even if three of four are — because the sentence they
 * remember is the headline, and a reassurance that is 75% true reads as a
 * promise about the item they are actually worried about.
 */
export function buildDesignChangeNotice(changes: DesignChange[]): DesignChangeNotice {
  const lines = (changes ?? []).map(buildChangeLine)
  const changed = lines.filter((l) => l.action !== "unchanged")

  const anyNotStarted = changed.some((l) => !l.reassuring)
  const allInHand = changed.length > 0 && !anyNotStarted

  let headline: string
  if (!changed.length) {
    headline = "No designs changed on your order."
  } else if (allInHand) {
    headline =
      changed.length === 1
        ? "We've updated a design on your order — and it's already in hand, so nothing is delayed. This is just our system keeping you in the loop."
        : "We've updated the designs on your order — they're all already in hand, so nothing is delayed. This is just our system keeping you in the loop."
  } else {
    headline =
      "We've updated the designs on your order. Here's exactly what changed and where each piece stands."
  }

  return {
    lines,
    changed_lines: changed,
    all_in_hand: allInHand,
    any_not_started: anyNotStarted,
    headline,
    should_send: changed.length > 0,
  }
}

/**
 * PURE: the item's next `metadata`, keeping `design_id` in step with the link
 * while preserving what the item was ORIGINALLY ordered as.
 *
 * 🔴 `updateOrderLineItems` MERGES metadata and offers no way to REMOVE a key
 * (probed: `delete` on the copy is inert, and an explicit null stores a literal
 * null with the key still present). So a detach writes `design_id: null`, which
 * both in-repo readers decline to resolve — each guards on
 * `typeof … === "string"`, not on key presence.
 *
 * 🔴 `original_design_id` is written ONCE, only when absent. Across repeated
 * re-points it therefore keeps the FIRST design, not the previous one: the
 * question it answers is "what did the customer order?", and that has exactly
 * one answer no matter how many times the item is moved afterwards.
 */
export function nextItemMetadata(
  existing: Record<string, any> | null | undefined,
  newDesignId: string | null
): Record<string, any> {
  const meta: Record<string, any> = { ...(existing ?? {}) }
  if (meta.design_id && !meta.original_design_id) {
    meta.original_design_id = meta.design_id
  }
  meta.design_id = newDesignId ?? null
  return meta
}
