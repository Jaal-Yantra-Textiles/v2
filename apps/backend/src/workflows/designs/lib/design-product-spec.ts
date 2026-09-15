import type { ProductSpecInput } from "../../products/upsert-product-spec"

/**
 * A design's sizes, as something the CUSTOMER chooses (#1970).
 *
 * ## Why a spec option group and not variants
 *
 * `create-product-from-design` mints one variant whose option axis is the
 * design's own name, so a customer cannot choose a size at all. The obvious
 * repair — one variant per size — is the one this platform has already tried
 * and reversed. `product-spec-option.ts` says why, about the piece it happened
 * to:
 *
 *   > "a variant is a stocked, priced thing. These are choices on a piece that
 *   > does not exist yet, so multiplying them into the variant matrix invents
 *   > SKUs nobody will ever hold. Moving 'Color Pattern' off the variant axis
 *   > of `ikat-grid-patterns-blue-yellow` is exactly this — 3 patterns × 2
 *   > spins = 6 phantom variants where 2 real ones will do."
 *
 * A garment woven to order in seven sizes is the same shape: seven SKUs that
 * will never be stocked, seven inventory items, seven price rows to fan out.
 * The made-to-spec surface already renders option groups, validates them at
 * add-to-cart and snapshots the answer onto the cart line — it was simply never
 * wired to the design mint, which writes no spec at all.
 *
 * 🔴 This also keeps the design QUOTABLE. `design-lines.ts:140` resolves a
 * design's variant only when exactly one backs it; minting seven would make
 * every multi-size design unquotable.
 */

/**
 * PURE: the size labels a design states, in the order it states them.
 *
 * Deduped — two `size_sets` rows both reading "M" would otherwise render two
 * identical buttons and ask the customer to choose between them.
 *
 * 🔴 NOT sorted. `design_size_set.size_label` is free text with no ordering
 * column, and the labels on prod include "Custom Bag" alongside "S"/"M"/"XL".
 * Any size order we imposed would be a guess that reorders someone's list; the
 * partner's own row order is the only stated one.
 */
export const designSizeLabels = (design: {
  size_sets?: ReadonlyArray<{ size_label?: string | null } | null> | null
}): string[] => {
  const seen = new Set<string>()
  const out: string[] = []

  for (const set of design?.size_sets ?? []) {
    const label = String(set?.size_label ?? "").trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }

  return out
}

/**
 * PURE: the spec to attach to a product minted from this design, or null when
 * the design says nothing worth writing.
 *
 * Three cases, and the difference between the first two is the whole point:
 *
 *  - **Several sizes** → a required `size` option group. A question for the
 *    customer.
 *  - **Exactly one size** → `size_label`, a stated FACT about the piece. One
 *    option with one value is not a choice; rendering it as one asks a question
 *    with a single possible answer, which reads as an unfinished page.
 *  - **No sizes** → null. Writing an empty spec row would make every design
 *    product claim a made-to-spec surface with nothing on it.
 *
 * Colour is deliberately absent. A design carries colour in two mutually
 * exclusive shapes (`colors` rows and the legacy `color_palette` blob) and no
 * sampled prod design has either populated; more importantly the palette and an
 * option group are two different questions, and the ikat seed's note applies —
 * asking colour twice "would let a customer answer it two ways".
 */
export const buildDesignSpec = (design: {
  size_sets?: ReadonlyArray<{ size_label?: string | null } | null> | null
}): ProductSpecInput | null => {
  const labels = designSizeLabels(design)

  if (labels.length === 0) return null

  if (labels.length === 1) {
    return { size_label: labels[0] }
  }

  return {
    size_label: null,
    options: [
      {
        key: "size",
        label: "Size",
        help_text: "Woven to order in the size you choose.",
        // No sensible default: a garment has no "usual" size, and defaulting
        // one would ship whatever happened to be first to a customer who never
        // looked at the control.
        required: true,
        order: 0,
        values: labels.map((label, order) => ({ label, order })),
      },
    ],
  }
}
