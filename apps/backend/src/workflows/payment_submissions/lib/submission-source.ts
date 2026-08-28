/**
 * WHERE a submission's money came from, folded from its lines.
 *
 * PURE: no container, no DB.
 *
 * A submission is a payout; its LINES carry the provenance. Reconciliation and
 * every screen that says "what is this payment for" need one answer, and the
 * honest answer is sometimes "more than one thing".
 */

export type SubmissionSourceLine = {
  source_type?: string | null
  design_id?: string | null
  task_id?: string | null
  inventory_order_id?: string | null
  order_id?: string | null
  production_run_ids?: string[] | null
}

export type SubmissionSource = {
  /** design | task | run | inventory_order | mixed | null when nothing is recorded. */
  source_type: string | null
  /**
   * The one id the source points at, when there is exactly one.
   *
   * Null for `mixed`, and null when a single-source submission names several
   * ids (three inventory orders on one payout) — a column that held the first
   * of three would be read as "this payout is for that order", which is false.
   */
  source_id: string | null
}

/**
 * The id a line points at, by its own source_type.
 *
 * ⚠️ A run-sourced line resolves to its ORDER, not to a run id. The line
 * deliberately groups runs — order #79's seven runs are ONE payout of ₹8,974,
 * not seven of ₹1,282 — so the order is the thing the money is "for". A line
 * with runs but no order has no single id, and says so.
 */
const lineSourceId = (line: SubmissionSourceLine): string | null => {
  const type = inferLineType(line)

  switch (type) {
    case "design":
      return line.design_id || null
    case "task":
      return line.task_id || null
    case "inventory_order":
      return line.inventory_order_id || null
    case "run":
      return line.order_id || null
    default:
      return null
  }
}

/**
 * A line's type, falling back to its ids for rows written before
 * `source_type` existed (#1614). Absence is not "design" — it is unknown, and
 * only the ids can say.
 */
const inferLineType = (line: SubmissionSourceLine): string | null => {
  if (line.source_type) return String(line.source_type)
  if (line.inventory_order_id) return "inventory_order"
  if (line.production_run_ids?.length) return "run"
  if (line.task_id) return "task"
  if (line.design_id) return "design"
  return null
}

export const resolveSubmissionSource = (
  lines: SubmissionSourceLine[] | null | undefined
): SubmissionSource => {
  const types = new Set<string>()
  const ids = new Set<string>()

  for (const line of lines || []) {
    const type = inferLineType(line)
    if (!type) continue
    types.add(type)

    const id = lineSourceId(line)
    if (id) ids.add(id)
  }

  if (types.size === 0) {
    return { source_type: null, source_id: null }
  }

  if (types.size > 1) {
    // Mixed is a real shape, not a failure. Reporting whichever line happened
    // to come first would assert something untrue about the rest.
    return { source_type: "mixed", source_id: null }
  }

  const [only] = Array.from(types)

  return {
    source_type: only,
    source_id: ids.size === 1 ? Array.from(ids)[0] : null,
  }
}
