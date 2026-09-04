import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaContainer } from "@medusajs/framework/types"

/**
 * The catalog an inventory order can pick from.
 *
 * ⚠️ Why this is not a filter on `/admin/inventory-items/raw-materials`:
 * that route's `query.graph` entry point IS the raw-material link table, so an
 * inventory item with no raw material behind it can never be emitted — under
 * any filter (#1662, same shape as #1621). This one enumerates
 * `inventory_item` itself, the real population, and hangs the raw material and
 * the product variant off each row. Nothing is partitioned away: an item that
 * is neither is still returned, as `kind: "unclassified"`.
 *
 * ⚠️ And the same trap one level up: enumerating `inventory_item` can only ever
 * emit variants that ALREADY have an item. A variant with
 * `manage_inventory: false` has no item row at all — not hidden, never created
 * — so the fabric case this issue exists for (one product, 37 variants, 0
 * tracked) is invisible to that sweep under any filter. Hence the SECOND
 * source below: product variants with no inventory item, emitted as
 * `kind: "untracked_variant"`. They are pickable, and tracking is established
 * when the order line is written (see `ensure-line-inventory-items.ts`).
 */
export type InventoryCatalogKind =
  | "raw_material"
  | "product"
  | "both"
  | "unclassified"
  | "untracked_variant"

/**
 * Deliberately the SAME row shape the raw-materials route emits
 * (`raw_materials` is the single linked material, or null) so the picker can
 * swap its source without a second parsing rule — one home for the fact
 * (#1613's lesson), plus the variants the old route could never carry.
 *
 * `inventory_item_id` is the field a caller should send when ordering a row
 * that is already tracked; `variant_id` is what it sends for an
 * `untracked_variant` row. Exactly one of them is non-null on any row. `id` is
 * a display/React key only — for an untracked row it is a deliberately
 * synthetic `untracked_variant:<variant_id>`, which no link write can mistake
 * for a real `iitem_…` and which fails loudly if one is attempted.
 */
export type InventoryCatalogRow = Record<string, any> & {
  raw_materials: Record<string, any> | null
  variants: Record<string, any>[]
  kind: InventoryCatalogKind
  inventory_item_id: string | null
  variant_id: string | null
  partner: { id: string; name: string | null } | null
}

const toRows = (value: unknown): Record<string, any>[] => {
  if (!value) {
    return []
  }
  const arr = Array.isArray(value) ? value : [value]
  return arr.filter((row: any) => row?.id)
}

const kindOf = (
  hasRawMaterial: boolean,
  hasVariant: boolean
): InventoryCatalogKind => {
  if (hasRawMaterial && hasVariant) {
    return "both"
  }
  if (hasRawMaterial) {
    return "raw_material"
  }
  if (hasVariant) {
    return "product"
  }
  return "unclassified"
}

const matchesQuery = (row: InventoryCatalogRow, needle: string): boolean => {
  const candidates: Array<string | undefined | null> = [
    row.title,
    row.sku,
    row.description,
    row.raw_materials?.name,
    row.raw_materials?.color,
    row.partner?.name,
    ...row.variants.flatMap((v) => [v?.title, v?.sku, v?.product?.title]),
  ]

  return candidates.some(
    (c) => typeof c === "string" && c.toLowerCase().includes(needle)
  )
}

/**
 * product_id → owning partner.
 *
 * Traversed from the PARTNER side on purpose: `partner-product.ts` declares
 * `field: "products"` on that side, so `products.id` is a name the link
 * actually defines. The reverse field name is not declared anywhere, and a
 * relation `query.graph` does not recognise is DROPPED in silence rather than
 * erroring — a guess here would read as "no partner owns anything".
 */
const buildPartnerByProduct = async (
  container: MedusaContainer
): Promise<Map<string, { id: string; name: string | null }>> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const byProduct = new Map<string, { id: string; name: string | null }>()

  try {
    const { data } = await query.graph({
      entity: "partner",
      fields: ["id", "name", "products.id"],
    })

    for (const partner of (Array.isArray(data) ? data : []) as any[]) {
      if (!partner?.id) {
        continue
      }
      const owned = { id: String(partner.id), name: partner.name ?? null }
      for (const product of toRows(partner.products)) {
        byProduct.set(String(product.id), owned)
      }
    }
  } catch (err) {
    // Ownership is a display aid on the row, not the thing being ordered.
    // Losing it must not cost the buyer the catalog.
    console.warn(
      `[inventory-catalog] partner ownership lookup skipped: ${
        (err as any)?.message || err
      }`
    )
  }

  return byProduct
}

export const getInventoryCatalog = async (
  container: MedusaContainer,
  options: { q?: string; kinds?: InventoryCatalogKind[] } = {}
): Promise<{ rows: InventoryCatalogRow[]; scanned: number }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const [{ data }, { data: variantData }, partnerByProduct] = await Promise.all([
    query.graph({
      entity: "inventory_item",
      fields: [
        "*",
        "raw_materials.*",
        "variants.id",
        "variants.title",
        "variants.sku",
        // #1744 — the variant's existing price, so the order-lines form can
        // pre-fill `price` when a finished-goods variant is picked. Money
        // amounts, one row per currency; the UI matches on INR (or first).
        "variants.prices.amount",
        "variants.prices.currency_code",
        "variants.product.id",
        "variants.product.title",
        "variants.product.thumbnail",
      ],
    }),
    // Entered from `product`, not `product_variant`, because these exact
    // relation names are the ones `bulk-update-products.ts:526` already proves
    // resolve. `query.graph` DROPS a relation it does not recognise in silence
    // — a wrong name here would report every tracked variant as untracked.
    query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "thumbnail",
        "variants.id",
        "variants.title",
        "variants.sku",
        "variants.manage_inventory",
        // #1744 — same reason as the inventory_item sweep above: carry the
        // untracked variant's price so the form can pre-fill it on pick.
        "variants.prices.amount",
        "variants.prices.currency_code",
        "variants.inventory_items.inventory_item_id",
        "variants.inventory_items.inventory.id",
      ],
    }),
    buildPartnerByProduct(container),
  ])

  const items = Array.isArray(data) ? data : []

  const rows: InventoryCatalogRow[] = items.map((item: any) => {
    // Two shapes to survive here: a to-one link comes back as an OBJECT
    // (`raw_materials`), a to-many as an array — and `query.graph` returns a
    // single all-null row for an empty to-many, so presence is judged on an
    // id, never on array length.
    const rawMaterials = toRows(item?.raw_materials)
    const variants = toRows(item?.variants)
    const productId = variants.find((v) => v?.product?.id)?.product?.id

    return {
      ...item,
      raw_materials: rawMaterials[0] ?? null,
      variants,
      kind: kindOf(rawMaterials.length > 0, variants.length > 0),
      inventory_item_id: String(item.id),
      variant_id: null,
      partner: productId ? partnerByProduct.get(String(productId)) ?? null : null,
    }
  })

  // The second source. A variant qualifies on the ABSENCE OF AN ITEM, not on
  // `manage_inventory` — locally one of the six tracked variants has no item
  // either, and filtering on the flag would leave it just as unorderable while
  // looking handled.
  const untracked: InventoryCatalogRow[] = []
  for (const product of (Array.isArray(variantData) ? variantData : []) as any[]) {
    const productId = product?.id ? String(product.id) : null
    const owner = productId ? partnerByProduct.get(productId) ?? null : null

    for (const variant of toRows(product?.variants)) {
      const links = Array.isArray(variant.inventory_items)
        ? variant.inventory_items
        : variant.inventory_items
        ? [variant.inventory_items]
        : []
      const linkedItemId =
        links.find((i: any) => i?.inventory?.id)?.inventory?.id ??
        links.find((i: any) => i?.inventory_item_id)?.inventory_item_id ??
        null

      if (linkedItemId) {
        continue
      }

      untracked.push({
        // Synthetic, and deliberately not shaped like an `iitem_…`.
        id: `untracked_variant:${variant.id}`,
        inventory_item_id: null,
        variant_id: String(variant.id),
        title: variant.title ?? product?.title ?? null,
        sku: variant.sku ?? null,
        description: null,
        thumbnail: product?.thumbnail ?? null,
        manage_inventory: !!variant.manage_inventory,
        raw_materials: null,
        variants: [
          {
            id: variant.id,
            title: variant.title,
            sku: variant.sku,
            prices: variant.prices ?? [],
            product: productId
              ? {
                  id: productId,
                  title: product.title,
                  thumbnail: product.thumbnail,
                }
              : undefined,
          },
        ],
        kind: "untracked_variant",
        partner: owner,
      })
    }
  }

  const all = [...rows, ...untracked]
  const scanned = all.length

  let result = all

  if (options.kinds?.length) {
    const wanted = new Set(options.kinds)
    result = result.filter((r) => wanted.has(r.kind))
  }

  const needle = options.q?.trim().toLowerCase()
  if (needle) {
    result = result.filter((r) => matchesQuery(r, needle))
  }

  return { rows: result, scanned }
}
