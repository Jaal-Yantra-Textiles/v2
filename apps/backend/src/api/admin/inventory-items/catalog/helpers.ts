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
 */
export type InventoryCatalogKind =
  | "raw_material"
  | "product"
  | "both"
  | "unclassified"

/**
 * Deliberately the SAME row shape the raw-materials route emits
 * (`raw_materials` is the single linked material, or null) so the picker can
 * swap its source without a second parsing rule — one home for the fact
 * (#1613's lesson), plus the variants the old route could never carry.
 */
export type InventoryCatalogRow = Record<string, any> & {
  raw_materials: Record<string, any> | null
  variants: Record<string, any>[]
  kind: InventoryCatalogKind
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
    ...row.variants.flatMap((v) => [v?.title, v?.sku, v?.product?.title]),
  ]

  return candidates.some(
    (c) => typeof c === "string" && c.toLowerCase().includes(needle)
  )
}

export const getInventoryCatalog = async (
  container: MedusaContainer,
  options: { q?: string; kinds?: InventoryCatalogKind[] } = {}
): Promise<{ rows: InventoryCatalogRow[]; scanned: number }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "inventory_item",
    fields: [
      "*",
      "raw_materials.*",
      "variants.id",
      "variants.title",
      "variants.sku",
      "variants.product.id",
      "variants.product.title",
      "variants.product.thumbnail",
    ],
  })

  const items = Array.isArray(data) ? data : []

  const rows: InventoryCatalogRow[] = items.map((item: any) => {
    // Two shapes to survive here: a to-one link comes back as an OBJECT
    // (`raw_materials`), a to-many as an array — and `query.graph` returns a
    // single all-null row for an empty to-many, so presence is judged on an
    // id, never on array length.
    const rawMaterials = toRows(item?.raw_materials)
    const variants = toRows(item?.variants)

    return {
      ...item,
      raw_materials: rawMaterials[0] ?? null,
      variants,
      kind: kindOf(rawMaterials.length > 0, variants.length > 0),
    }
  })

  const scanned = rows.length

  let result = rows

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
