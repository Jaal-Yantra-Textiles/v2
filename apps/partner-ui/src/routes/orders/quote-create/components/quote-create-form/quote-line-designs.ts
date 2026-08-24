/**
 * The two decisions behind "which design was this line made to" (#1501).
 *
 * Extracted from the panel because `apps/partner-ui` has no CI and no DOM test
 * harness, so anything left inside a component is checked by nothing at all.
 * Both of these have a way of being quietly wrong.
 */

export type DesignLineRow = { id: string; label: string }

/**
 * The variants that are actually LINES.
 *
 * 🔴 Quantity-bearing only. A partner who selected a ten-variant product to
 * quote one of them would otherwise be asked to attribute nine lines that will
 * never be minted, and the panel would be longer than the quote.
 *
 * 🔑 `Number("")` is `0`, which is why the guard is `> 0` and not a truthiness
 * check — an empty quantity cell must read as "not a line", and a truthiness
 * check on the raw string would call "0" a line and 0 not one.
 */
export function designLineRows(
  products: Array<{ title?: string | null; variants?: any[] | null }>,
  quantities: Record<string, unknown> | undefined
): DesignLineRow[] {
  const out: DesignLineRow[] = []
  for (const product of products ?? []) {
    for (const variant of product?.variants ?? []) {
      if (!variant?.id) continue
      const qty = Number(quantities?.[variant.id])
      if (!Number.isFinite(qty) || qty <= 0) continue
      out.push({
        id: variant.id,
        label: `${product.title ?? "Product"} — ${
          variant.title ?? variant.sku ?? variant.id
        }`,
      })
    }
  }
  return out
}

/**
 * Set or clear one line's design.
 *
 * 🔴 Clearing DELETES the key. Writing `""` looks equivalent and is not: the
 * payload builder sends `design_id` whenever the entry is present, so an empty
 * string would travel to the mint as a design id and be refused as one that
 * does not exist — a partner clearing a field would get a failed mint.
 *
 * Returns a new object; the form holds this value and React must see a change.
 */
export function assignDesign(
  current: Record<string, string> | undefined,
  variantId: string,
  designId?: string | null
): Record<string, string> {
  const next = { ...(current ?? {}) }
  if (!designId) delete next[variantId]
  else next[variantId] = designId
  return next
}
