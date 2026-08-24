import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

/**
 * Product options went global in Medusa 2.16: `ProductOption` is now a
 * standalone entity linked to products through a many-to-many pivot, and the
 * per-product set of usable values lives on `product_product_option_value`.
 *
 * 🔑 `product_id` on the create payload is a NO-OP since that change. Writing
 * it returns a clean 201 with `product_id: null` and leaves the product with
 * exactly the options it had before — which is how every partner attempt to
 * add an option silently did nothing, while minting a detached global row that
 * squats its title platform-wide (the unique index covers `is_exclusive=false`).
 *
 * Everything in production is exclusive — all 98 in-use options — because that
 * is what core creates for options authored on a product. Partner-authored
 * options follow suit: scoped to the one product, invisible to other tenants,
 * and outside the global title index so two partners can both have a "Color".
 */
export const PARTNER_OPTIONS_ARE_EXCLUSIVE = true

export type ProductOptionValue = { id: string; value: string }
export type ProductOptionRow = {
  id: string
  title: string
  values: ProductOptionValue[]
}

/**
 * The options a product actually carries, with the values in ITS subset —
 * not every value the underlying option row happens to own.
 */
export const listProductOptions = async (
  scope: any,
  productId: string
): Promise<ProductOptionRow[]> => {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "products",
    fields: [
      "id",
      "options.id",
      "options.title",
      "options.values.id",
      "options.values.value",
    ],
    filters: { id: productId },
  })

  return ((data?.[0]?.options ?? []) as any[]).map((option) => ({
    id: option.id,
    title: option.title,
    values: ((option.values ?? []) as any[]).map((v) => ({
      id: v.id,
      value: v.value,
    })),
  }))
}

/** Option titles are matched for humans: trimmed, case-insensitive. */
export const normalizeTitle = (title: unknown): string =>
  String(title ?? "").trim()

export const titlesMatch = (a: unknown, b: unknown): boolean =>
  normalizeTitle(a).toLowerCase() === normalizeTitle(b).toLowerCase()

/** Accepts `["S","M"]` or `[{ value: "S" }]`, which is what core emits back. */
export const normalizeValues = (values: unknown): string[] => {
  if (!Array.isArray(values)) {
    return []
  }
  return values
    .map((v) => (typeof v === "string" ? v : String((v as any)?.value ?? "")))
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * A curated option is a shared (`is_exclusive: false`) row that products LINK
 * rather than re-create — Colour and its 55-value palette is the first one.
 * Returns null for a title nobody has curated, which is the ordinary case: a
 * partner inventing "Spin Type" gets an exclusive option of their own.
 */
export const findCuratedOption = async (
  scope: any,
  title: string
): Promise<{ id: string; title: string; values: ProductOptionValue[] } | null> => {
  const productService: any = scope.resolve(Modules.PRODUCT)
  const rows = await productService.listProductOptions(
    { is_exclusive: false },
    { relations: ["values"] }
  )
  const match = (rows ?? []).find((o: any) => titlesMatch(o.title, title))
  if (!match) {
    return null
  }
  return {
    id: match.id,
    title: match.title,
    values: (match.values ?? []).map((v: any) => ({ id: v.id, value: v.value })),
  }
}

/**
 * Map requested value names onto a curated option's existing value ids.
 *
 * 🔑 A curated option is shared across every partner, so a partner may only
 * ever SELECT from it — never rename it and never mint a new value into it.
 * Without this, one partner adding "Neon Lime" would widen the vocabulary for
 * everyone, and the fixed palette would stop being fixed.
 */
export const resolvePaletteValueIds = (
  option: { title: string; values: ProductOptionValue[] },
  requested: string[]
): string[] => {
  const byName = new Map(
    option.values.map((v) => [v.value.toLowerCase(), v.id])
  )
  const unknown = requested.filter((v) => !byName.has(v.toLowerCase()))

  if (unknown.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${option.title} is a curated option — "${unknown.join(
        '", "'
      )}" is not in its palette. Choose from: ${option.values
        .map((v) => v.value)
        .join(", ")}.`
    )
  }

  return requested.map((v) => byName.get(v.toLowerCase()) as string)
}

export type ValueEntry = { value: string; hex?: string }

/**
 * Accepts `["Ivory", { value: "Sea Green", hex: "#2E8B57" }]`.
 *
 * An entry carrying a hex is a request to add a colour the curated palette does
 * not have — the escape hatch. Plain strings must already exist in the palette.
 */
export const normalizeValueEntries = (values: unknown): ValueEntry[] => {
  if (!Array.isArray(values)) {
    return []
  }
  return values
    .map((v) => {
      if (typeof v === "string") {
        return { value: v.trim() }
      }
      const entry = v as any
      const value = String(entry?.value ?? "").trim()
      const hex = entry?.hex ?? entry?.metadata?.hex
      return hex ? { value, hex: String(hex).trim() } : { value }
    })
    .filter((v) => !!v.value)
}

const HEX = /^#([0-9a-fA-F]{6})$/

/**
 * Resolve requested values against a curated option, minting the ones the
 * partner supplied a hex for.
 *
 * The 55 are the shared vocabulary, but a dyer's catalogue is not 55 colours
 * long — the pre-existing data already carried "Custom Color 105g" and
 * "Your Pick" because people needed a way through. So a partner MAY add one,
 * on two conditions: it carries a hex (a colour with no swatch is the bug we
 * are fixing), and it is stamped `custom` with its author so the picker can
 * show a partner the 55 plus their own, and never another partner's.
 *
 * ⚠️ Minting is two writes. Core's add path reads only `valueEntry.value` and
 * rebuilds the list as plain strings, so metadata passed inline is DROPPED —
 * the hex has to be set afterwards, by id.
 */
export const resolveCuratedValueIds = async (
  scope: any,
  option: { id: string; title: string; values: ProductOptionValue[] },
  requested: ValueEntry[],
  partnerId?: string | null
): Promise<string[]> => {
  const productService: any = scope.resolve(Modules.PRODUCT)
  const byName = new Map(option.values.map((v) => [v.value.toLowerCase(), v.id]))

  const known = requested.filter((r) => byName.has(r.value.toLowerCase()))
  const novel = requested.filter((r) => !byName.has(r.value.toLowerCase()))
  const withoutHex = novel.filter((r) => !r.hex)

  if (withoutHex.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${option.title} is a shared palette — "${withoutHex
        .map((r) => r.value)
        .join('", "')}" is not in it. Pick an existing colour, or supply a hex to add it.`
    )
  }

  const badHex = novel.filter((r) => !HEX.test(r.hex as string))
  if (badHex.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `A new colour needs a 6-digit hex like #2E8B57 — got "${badHex
        .map((r) => r.hex)
        .join('", "')}".`
    )
  }

  if (novel.length) {
    // Keep existing values by id: this call REPLACES the list, and a value
    // dropped here is a value pulled off every product already using it.
    await productService.updateProductOptions(option.id, {
      values: [
        ...option.values.map((v) => ({ id: v.id, value: v.value })),
        ...novel.map((r) => ({ value: r.value })),
      ],
    })

    const [refreshed] = await productService.listProductOptions(
      { id: option.id },
      { relations: ["values"] }
    )

    for (const entry of novel) {
      const row = (refreshed?.values ?? []).find(
        (v: any) => v.value === entry.value
      )
      if (!row) {
        continue
      }
      await productService.updateProductOptionValues(row.id, {
        metadata: {
          ...(row.metadata ?? {}),
          hex: entry.hex,
          custom: true,
          ...(partnerId ? { partner_id: partnerId } : {}),
        },
      })
      byName.set(entry.value.toLowerCase(), row.id)
    }
  }

  return [...known, ...novel].map(
    (r) => byName.get(r.value.toLowerCase()) as string
  )
}
