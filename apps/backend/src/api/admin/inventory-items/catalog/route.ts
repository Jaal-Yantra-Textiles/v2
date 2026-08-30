/**
 * GET /admin/inventory-items/catalog
 *
 * Every inventory item an inventory order can be placed against — raw
 * materials AND the finished fabric / finished goods a partner sells us
 * (#1662). Each row carries its raw material (if any) and the product
 * variants it backs (if any), plus a derived `kind` for display.
 *
 * Query parameters:
 *   - limit?: number (default 20)
 *   - offset?: number (default 0)
 *   - q?: string       // matches item title/sku/description, raw-material
 *                      // name, variant title/sku, product title
 *   - kinds?: string   // comma-separated: raw_material,product,both,unclassified
 *
 * Response (200):
 * {
 *   inventory_items: InventoryCatalogRow[],
 *   count: number,    // rows matching the query
 *   scanned: number,  // rows in the whole catalog before q/kinds — so a
 *                     // narrow result is never mistaken for a small catalog
 *   offset: number,
 *   limit: number
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { getInventoryCatalog } from "./helpers"
import type { ListInventoryCatalogQuery } from "./validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const qv = ((req as any).validatequery ?? (req as any).validatedQuery) as
    | Partial<ListInventoryCatalogQuery>
    | undefined

  const limit = Number(qv?.limit ?? 20)
  const offset = Number(qv?.offset ?? 0)

  const { rows, scanned } = await getInventoryCatalog(req.scope, {
    q: qv?.q,
    kinds: qv?.kinds,
  })

  res.status(200).json({
    inventory_items: rows.slice(offset, offset + limit),
    count: rows.length,
    scanned,
    offset,
    limit,
  })
}
