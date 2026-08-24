import { PRODUCT_SPEC_MODULE } from "../../product-spec"
import { WEAVE_TECHNIQUES } from "../../product-spec/weaving-techniques"
import { sizeFromSpec } from "./quote-size"

/**
 * "What the piece is made to", on the quote (#1428).
 *
 * ## Facts, not choices
 *
 * The product page's spec block does two jobs: it states FACTS (this cloth is
 * 240 GSM, 60 ends per inch, handwoven) and it offers CHOICES (pick a colour,
 * pick an embroidery). Only the facts belong on a quote.
 *
 * 🔴 The choices are deliberately dropped. A quote is frozen against SPECIFIC
 * variants at specific prices; rendering a palette next to them would tell a
 * procurement buyer they may pick a colour, and nothing on this page — or in
 * the price list behind it — can honour that. A configurator the buyer cannot
 * act on is worse than no configurator, and `accepting_custom_orders` is a
 * different transaction from the one this link exists to close.
 *
 * ## Rows come from the registry, never from a lookup here
 *
 * The stored spec carries param KEYS (`gsm`, `ends_per_inch`); a buyer needs
 * labels, units and a glyph. Those live in `weaving-techniques.ts`, which is
 * where a param is DEFINED — a mapping kept here would silently lose its entry
 * the day someone adds a param, and the row would render naked with nobody
 * noticing. A key the registry does not know still renders, as a plain row.
 */

export type QuoteSpecRow = {
  key: string
  label: string
  value: string
  unit: string | null
  /** A glyph NAME from the registry. The storefront draws it; see spec-icon. */
  icon: string
}

export type QuoteLineSpec = {
  weave_label: string | null
  rows: QuoteSpecRow[]
  finishes: string[]
  /**
   * The FINISHED piece, as one ready-to-render line ("Stole · 200 × 70 cm").
   *
   * Kept out of `rows` on purpose. The rows are the weave — a wall of
   * comparable numbers a buyer skims — and the size is the one measurement they
   * came looking for. Burying it between the yarn counts is how it goes unread.
   *
   * 🔴 This is the spec's answer, not the line's. The line resolves a stronger
   * one from the variant when size is a product option; see `quote-size.ts`.
   */
  size: string | null
}

/** `ends_per_inch` → `Ends per inch`. Only ever a fallback for an unknown key. */
const humanise = (key: string) =>
  String(key)
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())

/**
 * PURE: one spec row set, or null when the spec says nothing worth showing.
 *
 * Null rather than an empty block: a "Specification" heading over no rows
 * reads as missing data on a document a buyer is signing off.
 */
export function composeLineSpec(spec: any): QuoteLineSpec | null {
  if (!spec) return null

  const technique =
    WEAVE_TECHNIQUES.find((t) => t.slug === spec.weave_technique) ?? null
  const paramDefs = new Map(
    (technique?.params ?? []).map((p) => [p.key, p])
  )

  const rows: QuoteSpecRow[] = []

  const params = (spec.params ?? {}) as Record<string, unknown>
  for (const [key, raw] of Object.entries(params)) {
    if (raw === null || raw === undefined || raw === "") continue
    const def = paramDefs.get(key)
    rows.push({
      key,
      label: def?.label ?? humanise(key),
      value: String(raw),
      unit: def?.unit ?? null,
      // An unknown param is a plain row, never a blank space and never a crash.
      icon: def?.icon ?? "note",
    })
  }

  // Free extra fields — what the registry could not express. Ordered by the
  // partner, because they wrote them in the order they wanted them read.
  const fields = [...((spec.fields ?? []) as any[])].sort(
    (a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0)
  )
  for (const field of fields) {
    if (!field?.value) continue
    rows.push({
      key: String(field.key ?? ""),
      label: field.label || humanise(String(field.key ?? "")),
      value: String(field.value),
      unit: null,
      icon: "note",
    })
  }

  const finishes = ((spec.finishes ?? []) as any[])
    .map((f) => (typeof f === "string" ? f : f?.label ?? f?.name))
    .filter(Boolean)
    .map(String)

  const weaveLabel = spec.weave_label || technique?.label || null
  const size = sizeFromSpec(spec)

  // 🔴 `size` counts. A spec carrying ONLY a finished size used to compose to
  // null and take the whole block with it — the same shape as #1524, where
  // "nothing to show" was measured too narrowly and a configured band vanished.
  if (!rows.length && !finishes.length && !weaveLabel && !size) return null

  return { weave_label: weaveLabel, rows, finishes, size }
}

/**
 * Specs for a whole basket in ONE read, keyed by product id.
 *
 * Never throws. A missing spec is the normal state for most products, and a
 * spec module that fell over is not worth a buyer's 500 — both collapse to the
 * same "render the line without a spec block".
 */
export async function resolveQuoteSpecs(
  scope: any,
  productIds: string[]
): Promise<Map<string, QuoteLineSpec>> {
  const ids = Array.from(new Set(productIds.filter(Boolean)))
  const byProduct = new Map<string, QuoteLineSpec>()
  if (!ids.length) return byProduct

  try {
    const service: any = scope.resolve(PRODUCT_SPEC_MODULE)
    // `fields` only — the colour and option relations are the CHOICES half,
    // and loading them here would invite a later caller to render them.
    const specs = await service.listProductSpecs(
      { product_id: ids },
      { relations: ["fields"] }
    )
    for (const spec of (specs ?? []) as any[]) {
      const composed = composeLineSpec(spec)
      if (composed && spec.product_id) byProduct.set(spec.product_id, composed)
    }
  } catch {
    return byProduct
  }

  return byProduct
}
