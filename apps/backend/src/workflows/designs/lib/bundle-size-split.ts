import {
  checkOutputLines,
  sumOutput,
  type OutputLine,
} from "../../production-runs/lib/run-output"

/**
 * #2500 — how many pieces of each size a design's run makes when designs are
 * sent to a partner as a bundle (founder, 2026-11-02).
 *
 * 1. The design's OWN sizes first: split the pieces evenly across its
 *    `size_sets`, the remainder going to the earliest sizes. Jacket No 1
 *    (38, 40) × 2 → 38×1, 40×1. Bag for Paris ("Custom Bag") × 10 → all 10.
 * 2. Only a design with NO sizes gets the default by quantity:
 *    1 pc → M · 2 pcs → S, M · 3+ pcs → M, L, XL evenly (4 → M2 L1 XL1).
 * 3. 🔴 Nothing is invented. A garment with no sizes that needs the default is
 *    REFUSED until someone adds those sizes, with measurements, to the design —
 *    a run can only name sizes its design states (`checkOutputLines`), and a
 *    partner cannot cut an "L" with no numbers behind it.
 * 4. The sender can always say it themselves (`planned_output`), which wins.
 *    `[{ quantity: 3 }]` with no size is how to send a garment as one-size.
 *
 * Which designs need sizes at all: a design with no sizes whose product type is
 * plainly not sized — bags, scarves and stoles, home textiles, fabric — goes
 * as it always did, one undivided quantity. Anything else, including a design
 * with no product type, is treated as a garment and blocked: a wrongly blocked
 * bag costs the sender one override, a wrongly unblocked jacket costs a
 * partner a guess.
 */

export type SizeSplitLine = { size_label: string | null; quantity: number }

export type DesignSizeFacts = {
  /** `size_sets[].size_label`, in the design's order. */
  size_labels: string[]
  /** `colors[].name` — the colour axis a run's plan is checked against. */
  colors: string[]
  product_type?: string | null
}

export type PlannedSizeSplit =
  | {
      ok: true
      quantity: number
      /** Pieces per size, for the preview and the partner's message. Null = no sizes. */
      size_split: SizeSplitLine[] | null
      /** What is stored on the run as its plan. Null = nothing to store. */
      planned_output: OutputLine[] | null
      /** Why the split is shown but not stored, when it is not. */
      note?: string
    }
  | { ok: false; reason: string; missing_sizes?: string[] }

// Whole words of a product type ("tote_bag" → tote, bag), so "cape" is not a
// cap and "material" is not a mat.
const NON_SIZED_WORDS = new Set([
  "bag", "bags", "tote", "totes", "pouch", "pouches", "clutch", "wallet", "purse", "potli",
  "scarf", "scarves", "stole", "stoles", "shawl", "shawls", "dupatta", "dupattas", "muffler", "bandana",
  "cushion", "cushions", "pillow", "pillows", "towel", "towels", "napkin", "napkins",
  "tablecloth", "runner", "runners", "throw", "throws", "blanket", "blankets", "quilt", "quilts",
  "bedsheet", "bedsheets", "bedding", "curtain", "curtains", "rug", "rugs", "mat", "mats",
  "coaster", "coasters", "apron", "aprons", "fabric", "fabrics", "yardage", "mask", "masks",
])

export const isNonSizedProductType = (productType?: string | null): boolean =>
  String(productType ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => NON_SIZED_WORDS.has(w))

/** The default sizes for a design that states none, by how many pieces. */
export function defaultSizeLabels(quantity: number): string[] {
  if (quantity <= 1) return ["M"]
  if (quantity === 2) return ["S", "M"]
  return ["M", "L", "XL"]
}

/** Even split, remainder to the earliest labels; sizes that get 0 are dropped. */
export function evenSplit(labels: string[], quantity: number): SizeSplitLine[] {
  const n = labels.length
  const total = Math.max(0, Math.floor(Number(quantity) || 0))
  if (!n || !total) return []
  const base = Math.floor(total / n)
  const extra = total % n
  return labels
    .map((size_label, i) => ({ size_label, quantity: base + (i < extra ? 1 : 0) }))
    .filter((l) => l.quantity > 0)
}

const bySize = (lines: OutputLine[]): SizeSplitLine[] => {
  const out = new Map<string, SizeSplitLine>()
  for (const l of lines) {
    const key = l.size_label ?? ""
    const prev = out.get(key)
    out.set(key, {
      size_label: l.size_label ?? null,
      quantity: (prev?.quantity ?? 0) + Number(l.quantity || 0),
    })
  }
  return [...out.values()]
}

/** "38×1, 40×1", or null when there is nothing size-wise to say. */
export function formatSizeSplit(split: SizeSplitLine[] | null | undefined): string | null {
  const sized = (split ?? []).filter((l) => l.size_label)
  if (!sized.length) return null
  return sized.map((l) => `${l.size_label}×${l.quantity}`).join(", ")
}

export function planDesignSizeSplit(
  design: DesignSizeFacts,
  input: { quantity?: number | null; planned_output?: OutputLine[] | null }
): PlannedSizeSplit {
  const axes = { sizes: design.size_labels, colors: design.colors }

  // The sender's own split wins, and is held to the same rules as any plan.
  if (input.planned_output != null) {
    const total = sumOutput(input.planned_output)
    if (input.quantity != null && Number(input.quantity) !== total) {
      return {
        ok: false,
        reason: `the size split adds up to ${total} pcs but the quantity says ${input.quantity}`,
      }
    }
    const check = checkOutputLines(input.planned_output, axes, total)
    if (!check.ok) {
      return { ok: false, reason: `size split: ${check.reason}` }
    }
    if (!check.lines.length) {
      return { ok: false, reason: "size split: no pieces" }
    }
    return {
      ok: true,
      quantity: total,
      size_split: design.size_labels.length ? bySize(check.lines) : null,
      planned_output: check.lines,
    }
  }

  const quantity = Math.max(1, Math.floor(Number(input.quantity ?? 1) || 1))

  let split: SizeSplitLine[]
  if (design.size_labels.length) {
    split = evenSplit(design.size_labels, quantity)
  } else if (isNonSizedProductType(design.product_type)) {
    return { ok: true, quantity, size_split: null, planned_output: null }
  } else {
    const missing = defaultSizeLabels(quantity)
    return {
      ok: false,
      missing_sizes: missing,
      reason:
        `this design states no sizes. Add ${missing.join(", ")} with measurements to the design ` +
        `(or send your own size split) before it goes to the partner`,
    }
  }

  // The plan names a colour on every line when the design states colours. One
  // colour is that colour; with several, which piece is which is the sender's
  // call, so the size split is shown but not stored as the run's plan.
  if (design.colors.length > 1) {
    return {
      ok: true,
      quantity,
      size_split: split,
      planned_output: null,
      note: `the design has ${design.colors.length} colours, so the split is not stored as the run's plan; send a split with a colour per line to store it`,
    }
  }
  const color = design.colors[0] ?? null
  return {
    ok: true,
    quantity,
    size_split: split,
    planned_output: split.map((l) => ({ size_label: l.size_label, color, quantity: l.quantity })),
  }
}
