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
  /**
   * Per-piece prices first (#1596). A mixed-price line's `unit_amount` is null
   * by design — an average would be a rate nobody agreed to — so before this,
   * such a line showed no breakdown at all, and a partner checking a payout
   * could not see the rates they had themselves quoted.
   */
  const bands = rateBands(item)
  if (bands) {
    return bands
      .map((b) => `${b.quantity} × ${money(b.unit_amount, currency)}`)
      .join(" + ")
  }

  const qty = Number(item?.quantity)
  const unit = item?.unit_amount

  if (unit === null || unit === undefined) return null

  const unitValue = Number(unit)
  if (!Number.isFinite(unitValue)) return null
  if (!Number.isFinite(qty) || qty <= 0) return null

  return `${qty} × ${money(unitValue, currency)}`
}

/**
 * The per-piece price bands on a line, when it has more than one rate (#1596).
 *
 * 🔴 Mirrors `readRateBreakdown` in
 * `apps/backend/src/workflows/payment_submissions/lib/rate-breakdown.ts`, which
 * OWNS this shape. partner-ui cannot import across the app boundary, so the
 * rule is restated rather than shared: a single band is dropped, because it
 * says exactly what `quantity` and `unit_amount` already say, and a malformed
 * band is dropped rather than rendered as NaN at the partner it belongs to.
 */
const rateBands = (item: any): Array<{ quantity: number; unit_amount: number }> | null => {
  const raw = item?.rate_breakdown
  if (!Array.isArray(raw) || raw.length < 2) return null

  const bands = raw
    .filter(
      (b: any) =>
        b &&
        Number.isFinite(Number(b.quantity)) &&
        Number.isFinite(Number(b.unit_amount))
    )
    .map((b: any) => ({
      quantity: Number(b.quantity),
      unit_amount: Number(b.unit_amount),
    }))

  return bands.length >= 2 ? bands : null
}

/**
 * Group priced runs into the bands a line records (#1596).
 *
 * 🔴 Mirrors `groupIntoRateBands` in
 * `apps/backend/src/workflows/payment_submissions/lib/rate-breakdown-display.ts`,
 * which OWNS this shape — partner-ui cannot import across the app boundary, so
 * the rule is restated. Keep the two in step: the backend validator refuses
 * fewer than two bands and refuses a non-positive figure, so a screen that
 * disagrees turns a mistyped box into a 400 for the whole submission.
 *
 * Runs at the same rate merge into one band, and bands come back ordered by
 * rate so the same selection always sends the same payload.
 */
export const groupIntoRateBands = (
  entries: Array<{ quantity: number; unit_amount: number }> | null | undefined
): Array<{ quantity: number; unit_amount: number }> | null => {
  const byRate = new Map<number, number>()

  for (const entry of entries || []) {
    const quantity = Number(entry?.quantity)
    const rate = Number(entry?.unit_amount)
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    if (!Number.isFinite(rate) || rate <= 0) continue
    byRate.set(rate, (byRate.get(rate) || 0) + quantity)
  }

  if (byRate.size < 2) return null

  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([unit_amount, quantity]) => ({
      quantity: Math.round(quantity * 100) / 100,
      unit_amount,
    }))
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

/**
 * What one payable run BILLS on the create screen.
 *
 * 🔴 TWO HOMES. This is the partner-side copy of
 * `apps/backend/src/admin/components/creates/lib/run-line-pricing.ts`. The two
 * screens price the same runs and send the same request, and when they drifted
 * they disagreed by 22% on the same run on the same day: this screen used to
 * compute `unit_amount × quantity` for everything, so a job agreed at ₹10,000
 * as a TOTAL (9 ordered, 7 made) offered ₹7,777.77 here and ₹10,000 there. A
 * change to either file belongs in both.
 *
 * ## The rule
 *
 * A run carries either a rate or a total, and `unit_is_derived` says which. A
 * `per_unit` run was agreed at so much per piece, so its amount is
 * `quantity × rate` and moving the quantity moves the money.
 *
 * A `total` run was agreed at a price for the JOB. Its `unit_amount` is
 * `total / ordered`, sent purely so a screen can show a rate, and multiplying
 * it back out does NOT reproduce the total — it loses a paisa even when the
 * numbers line up, and cuts 22% when they do not. So an untouched total-priced
 * run bills its agreed figure VERBATIM and the quantity does not move it.
 *
 * Typing a rate is the way out: a human who has decided a per-unit price
 * outranks a stored figure, and from then on the row multiplies.
 */
export type RunLinePricingInput = {
  quantity: number
  rate: number
  /** What the API says is owed. For a total-priced run, the agreed total. */
  amount: number
  unit_is_derived?: boolean | null
  hasTypedRate: boolean
  /**
   * Whether a live line already claimed part of this run (#1596/#1676).
   *
   * The remainder of a total-priced job has no figure of its own: re-billing
   * the total double-pays, and dividing it re-prices work nobody re-negotiated.
   */
  alreadyPartlyBilled?: boolean | null
}

/** PURE. Whether this row still bills an agreed TOTAL rather than a rate. */
export const runBillsVerbatimTotal = (
  input: Pick<
    RunLinePricingInput,
    "unit_is_derived" | "hasTypedRate" | "alreadyPartlyBilled"
  >
): boolean =>
  !input.hasTypedRate && !!input.unit_is_derived && !input.alreadyPartlyBilled

/** PURE. Whether this row can state no price at all until somebody types one. */
export const runNeedsTypedPrice = (
  input: Pick<
    RunLinePricingInput,
    "unit_is_derived" | "hasTypedRate" | "alreadyPartlyBilled"
  >
): boolean =>
  !input.hasTypedRate && !!input.unit_is_derived && !!input.alreadyPartlyBilled

/** PURE. What this run bills. */
export const runLineAmount = (input: RunLinePricingInput): number => {
  // Before both other branches: re-billing the total double-pays, and
  // multiplying the derived rate re-prices the job.
  if (runNeedsTypedPrice(input)) {
    return 0
  }
  if (runBillsVerbatimTotal(input)) {
    // Verbatim. Not rounded, not re-derived, not multiplied.
    return input.amount
  }
  const quantity = Number(input.quantity)
  const rate = Number(input.rate)
  if (!Number.isFinite(quantity) || !Number.isFinite(rate)) {
    return 0
  }
  return Math.round(quantity * rate * 100) / 100
}

/**
 * How to label ONE submission line, whatever it is sourced from (#1710).
 *
 * 🔑 The `default` branch is load-bearing: a source type this build has never
 * heard of still gets a row, a readable title and its amount. The previous
 * design — one table per known type — made an unknown type vanish silently,
 * which is how `run` and `inventory_order` lines came to render nowhere on
 * this screen while still counting toward the total.
 */
export const describeLine = (
  item: any
): {
  title: string
  subtitle: string | null
  badge: string
  badgeColor: "blue" | "purple" | "orange" | "green" | "grey"
  billedFor: string
} => {
  /**
   * ⚠️ Normalise FIRST. `source_type` defaults to `design` on the model, but
   * rows written before the discriminator existed carry null, and every other
   * reader in the codebase resolves those by asking which id is populated. A
   * switch on the raw field sent them to the unknown branch and badged a
   * perfectly ordinary design line "Item".
   */
  const sourceType =
    item.source_type || (item.task_id ? "task" : item.design_id ? "design" : null)

  switch (sourceType) {
    case "task":
      return {
        title: item.task_name || "Untitled task",
        subtitle: item.task_id ?? null,
        badge: "Task",
        badgeColor: "purple",
        billedFor: "One task",
      }
    case "run":
      return {
        title: item.design_name || "Production run",
        subtitle: (item.production_run_ids || []).join(", ") || null,
        badge: "Run",
        badgeColor: "green",
        billedFor: "Production run",
      }
    case "inventory_order":
      return {
        title: item.inventory_order_name || "Inventory order",
        subtitle: item.inventory_order_id ?? null,
        badge: "Goods",
        badgeColor: "orange",
        billedFor: "Material delivered",
      }
    case "design":
      return {
        title: item.design_name || "Unnamed design",
        subtitle: null,
        badge: "Design",
        badgeColor: "blue",
        billedFor: "One line, no rate given",
      }
    default:
      /**
       * ⚠️ Not an error state — a line whose type this build does not know is
       * still money this partner is owed, and hiding it is strictly worse than
       * labelling it plainly.
       */
      return {
        title:
          item.design_name ||
          item.task_name ||
          item.inventory_order_name ||
          "Payment line",
        subtitle: sourceType ? `source: ${sourceType}` : null,
        badge: "Item",
        badgeColor: "grey",
        billedFor: "One line, no rate given",
      }
  }
}

/**
 * "2 designs · 1 task · 3 goods" — counted off `source_type` rather than off a
 * fixed list of the two types this screen used to know about (#1710).
 */
export const summariseItems = (items: any[]): string => {
  const LABELS: Record<string, [string, string]> = {
    design: ["design", "designs"],
    task: ["task", "tasks"],
    run: ["run", "runs"],
    inventory_order: ["goods line", "goods lines"],
  }

  const counts = new Map<string, number>()
  for (const item of items) {
    // An item with no `source_type` at all predates the discriminator and is a
    // design line by the same rule every other reader uses.
    const key = item.source_type || (item.task_id ? "task" : "design")
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([key, n]) => {
      const [one, many] = LABELS[key] ?? [key, `${key}s`]
      return `${n} ${n === 1 ? one : many}`
    })
    .join(" · ")
}
