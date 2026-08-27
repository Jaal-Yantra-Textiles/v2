/**
 * How a payment submission's money reads on screen (#1556).
 *
 * The create screen has billed RUNS with an explicit quantity and unit rate
 * since #1579. The detail screen showed a design name and a total — so the two
 * money screens disagreed about what a submission was, and the one a partner
 * opens to check what they were paid could not answer "for how many, at what
 * rate". These are the pure parts of closing that gap.
 */

/**
 * Money, in the submission's OWN currency.
 *
 * 🔴 The detail page hardcoded `₹` in three places while
 * `payment_submission.currency` is a real column that merely DEFAULTS to
 * "inr". A submission in any other currency rendered its amount with a rupee
 * sign in front — the number right, the label a lie, and a lie about what a
 * partner is owed.
 */
export const money = (amount: unknown, currency?: string | null): string => {
  const value = Number(amount)
  const code = (currency || "inr").toUpperCase()

  if (amount === null || amount === undefined || !Number.isFinite(value)) {
    return "—"
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    // An unknown code must not blank the amount — show the number and the code.
    return `${value.toLocaleString()} ${code}`
  }
}

/**
 * What a line actually bills, in words: "9 × ₹850".
 *
 * 🔴 Reads `unit_amount`, and returns null when it is absent rather than
 * dividing `amount` by `quantity`. The model says so in as many words: `amount`
 * is the authoritative total, and a reader that wants "9 × 850" must check
 * `unit_amount != null` rather than dividing and hoping. A derived rate on a
 * line that never carried one would present a number nobody entered as though
 * the partner had agreed to it.
 */
export const perUnit = (item: any, currency?: string | null): string | null => {
  const qty = Number(item?.quantity)
  const unit = item?.unit_amount

  if (unit === null || unit === undefined) return null

  const unitValue = Number(unit)
  if (!Number.isFinite(unitValue)) return null
  if (!Number.isFinite(qty) || qty <= 0) return null

  return `${qty} × ${money(unitValue, currency)}`
}

/** What the run-provenance note should say, or null for "say nothing". */
export type ProvenanceLabel = { text: string; muted: boolean } | null

/**
 * Which production runs a line paid for — or an honest admission that we
 * cannot tell.
 *
 * 🔴 Read from `run_provenance`, NEVER inferred from `production_run_ids`.
 * That column exists precisely because `production_run_ids IS NULL` was doing
 * the work of three different facts, and a reader that re-derives it has
 * re-created the ambiguity the column was added to end:
 *
 * - `recorded`     — the runs are named. Safe to show.
 * - `no_run`       — nothing produced this (a task, a hand-picked design).
 *                    Absence is correct and final, so say nothing.
 * - `not_recorded` — it DID pay for run work whose run was never written down.
 *                    Shown, because "we cannot tell what this paid for" is
 *                    information a partner querying a payment needs, and
 *                    rendering it as silence would read as "no runs involved".
 */
export const provenanceLabel = (item: any): ProvenanceLabel => {
  const provenance: string | undefined = item?.run_provenance
  const runIds: unknown = item?.production_run_ids
  const count = Array.isArray(runIds) ? runIds.length : 0

  if (provenance === "no_run") return null

  if (provenance === "recorded") {
    // `recorded` promises the ids are there. If they are not, the line is
    // making a claim it cannot back — which is the `not_recorded` case wearing
    // the wrong label, and it must not read as reassurance.
    if (!count) return { text: "Runs not recorded on this line", muted: true }
    return {
      text: count === 1 ? "1 production run" : `${count} production runs`,
      muted: false,
    }
  }

  if (provenance === "not_recorded") {
    return { text: "Runs not recorded on this line", muted: true }
  }

  return null
}
