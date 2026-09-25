import { MedusaError } from "@medusajs/framework/utils"

/**
 * What a run is expected to make, and what it actually made, per variant (#2271).
 *
 * A run carried one number — `quantity` — and a design can state several sizes
 * and colours. So a run of 3 on a design stating S and M could never say which
 * sizes it made, and the goods were banked onto one sizeless variant: the Luong
 * Shirt run on prod is exactly that shape.
 *
 * Two typed columns answer it:
 *
 *  - `planned_output` — set BEFORE production: the split the run is expected to
 *    make. It is the default the partner confirms against.
 *  - `produced_output` — set AT COMPLETION: the split the partner confirms was
 *    actually made, in GOOD units (rejects are not stock).
 *
 * A line names at most one value per axis. The axes are the ones the run's own
 * snapshot states — the sizes and colours the design had when the work was
 * commissioned — so a line cannot claim a size the run was never asked for.
 *
 * 🔴 Nothing here guesses. When the run states several combinations and
 * neither the partner nor the plan says which were made, the answer is
 * `split_required`, never the first combination.
 */

export type OutputLine = {
  size_label?: string | null
  color?: string | null
  quantity: number
}

export type RunOutputAxes = {
  sizes: string[]
  colors: string[]
}

const clean = (v: unknown): string => String(v ?? "").trim()

const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/**
 * PURE: the sizes and colours a run's snapshot states, in the order stated.
 *
 * Colours are read by NAME: `design_colors.name` is what a partner and a
 * customer call it; the hex code is a swatch, not an identity.
 */
export function runOutputAxes(snapshot: unknown): RunOutputAxes {
  const s = (snapshot ?? {}) as {
    size_sets?: Array<{ size_label?: string | null } | null> | null
    colors?: Array<{ name?: string | null } | null> | null
  }
  return {
    sizes: dedupe((s.size_sets ?? []).map((r) => clean(r?.size_label))),
    colors: dedupe((s.colors ?? []).map((r) => clean(r?.name))),
  }
}

/** Stable key for one combination, used to merge duplicate lines. */
export const outputLineKey = (line: Pick<OutputLine, "size_label" | "color">): string =>
  `${clean(line.size_label)}\u0000${clean(line.color)}`

export type OutputLinesCheck =
  | { ok: true; lines: OutputLine[] }
  | { ok: false; reason: string }

/**
 * PURE: validate and normalise a split against the run's axes.
 *
 * - Every quantity is a positive finite number. Zero lines are dropped, so a
 *   form that pre-fills every size can send the ones nobody made.
 * - An axis the run states is REQUIRED on every line, and must be one of its
 *   values. A sizeless line on a sized run is exactly the ambiguity this exists
 *   to remove.
 * - An axis the run does NOT state must be absent: a colour on a design with no
 *   colours names a variant nothing can be traced to.
 * - Two lines for the same combination are merged.
 * - When `total` is given, the lines must add up to it exactly.
 */
export function checkOutputLines(
  input: unknown,
  axes: RunOutputAxes,
  total?: number | null
): OutputLinesCheck {
  if (!Array.isArray(input)) {
    return { ok: false, reason: "output must be a list of { size_label, color, quantity } lines" }
  }

  const merged = new Map<string, OutputLine>()

  for (const raw of input as Array<Partial<OutputLine> | null>) {
    const quantity = Number(raw?.quantity)
    if (!Number.isFinite(quantity) || quantity < 0) {
      return { ok: false, reason: `every line needs a quantity of 0 or more (got ${raw?.quantity})` }
    }
    if (quantity === 0) continue

    const size = clean(raw?.size_label)
    const color = clean(raw?.color)

    if (axes.sizes.length) {
      if (!size) {
        return { ok: false, reason: `every line needs a size — this run is for ${axes.sizes.join(", ")}` }
      }
      if (!axes.sizes.includes(size)) {
        return { ok: false, reason: `size "${size}" is not one this run is for (${axes.sizes.join(", ")})` }
      }
    } else if (size) {
      return { ok: false, reason: `this run's design states no sizes, so a line cannot claim "${size}"` }
    }

    if (axes.colors.length) {
      if (!color) {
        return { ok: false, reason: `every line needs a colour — this run is for ${axes.colors.join(", ")}` }
      }
      if (!axes.colors.includes(color)) {
        return { ok: false, reason: `colour "${color}" is not one this run is for (${axes.colors.join(", ")})` }
      }
    } else if (color) {
      return { ok: false, reason: `this run's design states no colours, so a line cannot claim "${color}"` }
    }

    const line: OutputLine = {
      size_label: size || null,
      color: color || null,
      quantity,
    }
    const key = outputLineKey(line)
    const existing = merged.get(key)
    merged.set(key, existing ? { ...existing, quantity: existing.quantity + quantity } : line)
  }

  const lines = [...merged.values()]

  if (total != null) {
    const sum = sumOutput(lines)
    if (sum !== Number(total)) {
      return { ok: false, reason: `the lines add up to ${sum}, but the run accounts for ${total}` }
    }
  }

  return { ok: true, lines }
}

/**
 * PURE: the good units a completion reports — what stocking banks.
 *
 * 🔴 `produced_quantity` IS the good output; rejects are reported beside it,
 * not inside it (#2271, founder 2026-09-25). That is how `checkCompletionOutput`
 * accounts (`produced + rejected` against the order), how the partner form is
 * labelled ("Good pieces produced"), and now how stocking and goods transfers
 * read it. Stocking used to bank `produced - rejected`, subtracting the rejects
 * a second time: 8 good + 2 rejected banked 6. No completed prod run had
 * rejects when this changed (0 of 81, 2026-09-25), so nothing banked moves.
 *
 * Only when no produced figure is given is the ordered quantity the fallback,
 * and then the rejects do come out of it — the order was never split.
 *
 * The split must add up to exactly what is banked, so it shares this one
 * definition.
 */
export function runGoodQuantity(input: {
  produced_quantity?: number | null
  rejected_quantity?: number | null
  quantity?: number | null
}): number {
  if (input.produced_quantity != null) {
    return Math.max(0, Number(input.produced_quantity) || 0)
  }
  const ordered = Number(input.quantity ?? 0) || 0
  const rejected = Number(input.rejected_quantity ?? 0) || 0
  return Math.max(0, ordered - rejected)
}

export const sumOutput = (lines: ReadonlyArray<OutputLine> | null | undefined): number =>
  (lines ?? []).reduce((acc, l) => acc + Number(l?.quantity ?? 0), 0)

/**
 * PURE: the ONE combination a run can make, or null when it states several.
 *
 * A run stating at most one size and at most one colour has no split to
 * choose — every unit is that combination, and asking the partner would be a
 * question with a single answer.
 */
export function soleCombination(
  axes: RunOutputAxes
): Pick<OutputLine, "size_label" | "color"> | null {
  if (axes.sizes.length > 1 || axes.colors.length > 1) return null
  return { size_label: axes.sizes[0] ?? null, color: axes.colors[0] ?? null }
}

export type ProducedOutputSource = "confirmed" | "planned" | "sole_combination" | "none"

export type ProducedOutputResult =
  | { ok: true; lines: OutputLine[]; source: ProducedOutputSource }
  | { ok: false; reason: string; code: "invalid_confirmed" | "split_required" }

/**
 * PURE: what a run actually made, per combination, at completion.
 *
 * Order of authority:
 *  1. `confirmed` — the partner's (or admin's) own split. Validated; an invalid
 *     one is an ERROR, never silently replaced by the plan.
 *  2. `planned_output` — when it adds up to the good units. A plan for 3 on a
 *     run that made 2 is no longer an answer about which 2.
 *  3. The run's sole combination, when it states only one.
 *  4. Otherwise `split_required`.
 *
 * Zero good units → no lines, whatever was planned.
 */
export function resolveProducedOutput(input: {
  confirmed?: unknown
  planned_output?: unknown
  snapshot?: unknown
  good_quantity: number
}): ProducedOutputResult {
  const axes = runOutputAxes(input.snapshot)
  const good = Math.max(0, Number(input.good_quantity) || 0)

  if (input.confirmed != null) {
    const check = checkOutputLines(input.confirmed, axes, good)
    return check.ok
      ? { ok: true, lines: check.lines, source: "confirmed" }
      : { ok: false, reason: check.reason, code: "invalid_confirmed" }
  }

  if (good === 0) return { ok: true, lines: [], source: "none" }

  if (input.planned_output != null) {
    const planned = checkOutputLines(input.planned_output, axes, good)
    if (planned.ok) return { ok: true, lines: planned.lines, source: "planned" }
  }

  const sole = soleCombination(axes)
  if (sole) {
    return { ok: true, lines: [{ ...sole, quantity: good }], source: "sole_combination" }
  }

  return {
    ok: false,
    code: "split_required",
    reason:
      `this run is for ${[
        axes.sizes.length ? `sizes ${axes.sizes.join(", ")}` : null,
        axes.colors.length ? `colours ${axes.colors.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" and ")}; say how many of each were made (${good} good units)`,
  }
}

/**
 * #2271 — a child's expected split per size/colour.
 *
 * The assignment's own plan wins, and is validated against the child's
 * snapshot and quantity. Otherwise the parent's plan carries over only when it
 * adds up to the child's quantity — in a chain where every partner works every
 * unit (weave, then stitch) each child makes the whole plan. A child with a
 * different share gets no plan rather than a wrong one; completion then asks.
 */
export function childPlannedOutput(input: {
  assignment?: unknown
  parent?: unknown
  snapshot: unknown
  quantity: number | null
  partnerId?: string
}): OutputLine[] | null {
  const axes = runOutputAxes(input.snapshot)

  if (input.assignment != null) {
    const check = checkOutputLines(input.assignment, axes, input.quantity)
    if (!check.ok) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `planned_output for partner ${input.partnerId ?? "?"}: ${check.reason}`
      )
    }
    return check.lines.length ? check.lines : null
  }

  if (input.parent == null || input.quantity == null) return null
  const inherited = checkOutputLines(input.parent, axes, input.quantity)
  return inherited.ok && inherited.lines.length ? inherited.lines : null
}

/**
 * PURE: "S:1, M:2" or "S/Indigo:1" → lines, for places a split arrives as one
 * string (maintenance-job params, a query string). Throws on a malformed part.
 */
export function parseOutputParam(raw: string): OutputLine[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.lastIndexOf(":")
      if (idx <= 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `produced_output: "${part}" is not SIZE:QTY (e.g. S:1,M:2)`
        )
      }
      const combo = part.slice(0, idx).trim()
      const quantity = Number(part.slice(idx + 1).trim())
      const [size, color] = combo.split("/").map((s) => s.trim())
      return { size_label: size || null, color: color || null, quantity }
    })
}
