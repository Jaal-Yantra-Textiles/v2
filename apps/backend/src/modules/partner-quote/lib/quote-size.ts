/**
 * "How big is the thing I am buying?", on the quote line.
 *
 * ## Why this needed a helper at all
 *
 * A buyer approving a consignment could read the ends-per-inch and the GSM but
 * not the size of the piece. Nothing on the quote carried it: the production
 * spec described the WEAVE, `loom_width_cm` is the cloth on the loom rather
 * than the finished article, and the product's own `length/width/height` live
 * on a tab of the product page the buyer opening a quote link never sees.
 *
 * ## Three sources, in the order a partner would trust them
 *
 * 1. **The variant.** If size is a product OPTION, the variant IS a size and
 *    the partner has already stated it per-SKU. Nothing else can be more
 *    specific than the thing being quoted.
 * 2. **The production spec.** `size_label` + finished dimensions — authored
 *    once for the product, which is where a made-to-order piece states it.
 * 3. **The product's own dimensions.** Medusa's `length`/`width`, already shown
 *    on the product page's "Product information" tab, so a partner who filled
 *    those in gets the size on a quote for free.
 *
 * 🔑 The chain resolves to ONE answer and says which source it came from, the
 * same way `weight_source` and `image_source` do on this view. A product-level
 * size on a variant-specific line is a weaker claim than the variant's own, and
 * a buyer signing off a consignment is entitled to know which they are reading.
 *
 * 🔴 A FACT, never a picker. The quote is frozen against specific variants at
 * specific prices, so offering a size to choose would describe an agreement
 * nothing behind the page can honour — the same rule that keeps the palette and
 * the option groups out of `quote-spec.ts`.
 */

export type QuoteLineSize = {
  /** One line, ready to render. "Stole · 200 × 70 cm" */
  label: string
  /** Which claim this is, so the page can caveat a weak one. */
  source: "variant" | "spec" | "product"
}

/** Option titles that mean "how big". Matched case- and space-insensitively. */
const SIZE_OPTION_TITLES = ["size", "dimensions", "dimension", "measurements"]

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim()
  return s ? s : null
}

/**
 * A number that means something. `0` is not a size, and neither is `NaN` — both
 * arrive from the database as plausible-looking values on a row nobody filled
 * in, and both would render as "0 × 0 cm" beside a price.
 */
const dim = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** "200 × 70 cm", "200 cm", or null when neither number is there. */
export function formatDimensions(
  length: unknown,
  width: unknown,
  unit = "cm"
): string | null {
  const l = dim(length)
  const w = dim(width)
  if (l && w) return `${l} × ${w} ${unit}`
  // One dimension alone is still worth saying — a 200 cm stole of unstated
  // width tells a buyer more than nothing does.
  if (l) return `${l} ${unit}`
  if (w) return `${w} ${unit}`
  return null
}

/** The variant's own size, when size is one of the product's options. */
export function sizeFromVariant(variant: any): string | null {
  const options = (variant?.options ?? []) as any[]
  for (const o of options) {
    const title = clean(o?.option?.title)?.toLowerCase()
    if (title && SIZE_OPTION_TITLES.includes(title)) {
      const value = clean(o?.value)
      if (value) return value
    }
  }
  return null
}

/** The production spec's finished size — a name, a measurement, or both. */
export function sizeFromSpec(spec: any): string | null {
  const label = clean(spec?.size_label)
  const measured = formatDimensions(
    spec?.finished_length_cm,
    spec?.finished_width_cm
  )
  if (label && measured) return `${label} · ${measured}`
  return label ?? measured
}

/**
 * The product's catalogue dimensions.
 *
 * Medusa stores these unitless — the product page prints "200L x 70W x 30H"
 * with no unit at all — so this states cm rather than inventing a unit field.
 * Every product in this catalogue is measured in cm; if that ever stops being
 * true it is a data problem, not a formatting one, and it should be fixed where
 * the number is entered.
 */
export function sizeFromProduct(product: any): string | null {
  return formatDimensions(product?.length, product?.width)
}

/**
 * The one answer, from the strongest source that has one.
 *
 * `spec_size` arrives already composed (by `composeLineSpec`, via
 * `sizeFromSpec`) rather than as a raw spec row, so the spec module keeps
 * ownership of what its own columns mean and this file owns only the ordering.
 */
export function resolveLineSize(input: {
  variant?: any
  spec_size?: string | null
  product?: any
}): QuoteLineSize | null {
  const fromVariant = sizeFromVariant(input.variant)
  if (fromVariant) return { label: fromVariant, source: "variant" }

  const fromSpec = clean(input.spec_size)
  if (fromSpec) return { label: fromSpec, source: "spec" }

  const fromProduct = sizeFromProduct(input.product)
  if (fromProduct) return { label: fromProduct, source: "product" }

  return null
}
