/**
 * #2271 — which sizes/colours a completed run made.
 *
 * The run's snapshot states the sizes and colours it was commissioned for. When
 * it states several, the partner confirms how many of each were made, so the
 * goods reach stock as the right variant instead of one sizeless one. The
 * backend re-checks all of this (`workflows/production-runs/lib/run-output.ts`);
 * this module only decides what the form shows and sends.
 *
 * Pure, and outside the component, because partner-ui has no DOM test harness:
 * anything left in the component is checked by nothing.
 */

export type SplitLine = {
  size_label: string | null
  color: string | null
  quantity: number
}

export type SplitAxes = { sizes: string[]; colors: string[] }

const clean = (v: unknown): string => String(v ?? "").trim()

const dedupe = (values: string[]): string[] => {
  const out: string[] = []
  for (const v of values) if (v && !out.includes(v)) out.push(v)
  return out
}

/** The sizes and colour names the run's snapshot states, in stated order. */
export function splitAxes(run: any): SplitAxes {
  const snapshot = run?.snapshot ?? {}
  return {
    sizes: dedupe((snapshot.size_sets ?? []).map((s: any) => clean(s?.size_label))),
    colors: dedupe((snapshot.colors ?? []).map((c: any) => clean(c?.name))),
  }
}

/** Does this run need the partner to say which combinations were made? */
export const needsSplit = (axes: SplitAxes): boolean =>
  axes.sizes.length > 1 || axes.colors.length > 1

export const comboKey = (size: string | null, color: string | null): string =>
  `${size ?? ""}\u0000${color ?? ""}`

/** Every size × colour combination the run is for, one row each. */
export function splitCombos(axes: SplitAxes): Array<{ size_label: string | null; color: string | null }> {
  const sizes: Array<string | null> = axes.sizes.length ? axes.sizes : [null]
  const colors: Array<string | null> = axes.colors.length ? axes.colors : [null]
  const combos: Array<{ size_label: string | null; color: string | null }> = []
  for (const size_label of sizes) for (const color of colors) combos.push({ size_label, color })
  return combos
}

/**
 * The starting quantities: the run's `planned_output` when it adds up to the
 * units going to stock. Otherwise blank — a plan for 3 on a run that made 2
 * says nothing about which 2, and pre-filling it would invite a wrong confirm.
 */
export function initialSplit(run: any, axes: SplitAxes, target: number): Record<string, string> {
  const planned: any[] = Array.isArray(run?.planned_output) ? run.planned_output : []
  const sum = planned.reduce((acc, l) => acc + (Number(l?.quantity) || 0), 0)
  const values: Record<string, string> = {}
  if (planned.length && sum === target) {
    for (const l of planned) {
      const key = comboKey(clean(l?.size_label) || null, clean(l?.color) || null)
      values[key] = String(Number(l?.quantity) || 0)
    }
  }
  for (const c of splitCombos(axes)) {
    const key = comboKey(c.size_label, c.color)
    if (!(key in values)) values[key] = ""
  }
  return values
}

export type SplitPlan =
  | { needed: false }
  | { needed: true; lines: SplitLine[]; total: number; target: number; ok: boolean }

/**
 * What to send as `produced_output`, and whether it adds up.
 *
 * `target` is the units going to stock (good output). Not needed → the field is
 * omitted and the backend infers the run's only combination.
 */
export function planSplit(
  axes: SplitAxes,
  values: Record<string, string>,
  target: number
): SplitPlan {
  if (!needsSplit(axes)) return { needed: false }
  const lines: SplitLine[] = []
  for (const c of splitCombos(axes)) {
    const quantity = parseFloat(values[comboKey(c.size_label, c.color)] ?? "") || 0
    if (quantity > 0) lines.push({ ...c, quantity })
  }
  const total = lines.reduce((acc, l) => acc + l.quantity, 0)
  return { needed: true, lines, total, target, ok: total === target }
}

export const comboLabel = (c: { size_label: string | null; color: string | null }): string =>
  [c.size_label, c.color].filter(Boolean).join(" · ")
