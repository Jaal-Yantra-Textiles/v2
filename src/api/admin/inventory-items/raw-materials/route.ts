/**
 * GET /admin/inventory-items/raw-materials
 *
 * Description:
 *   Returns inventory items enriched with their associated raw materials.
 *
 * Query parameters (via validated query middleware):
 *   - limit?: number (default 10)        // page size
 *   - offset?: number (default 0)        // pagination offset
 *   - q?: string                         // full-text search across inventory/raw material fields
 *   - filters?: object                   // additional filter object (use validated schema)
 *
 * Response (200):
 * {
 *   inventory_items: Array<Record<string, any>>,
 *   count: number,   // total matching items
 *   offset: number,
 *   limit: number
 * }
 *
 * Examples:
 *
 * curl
 * curl -X GET "https://api.example.com/admin/inventory-items/raw-materials?limit=5&offset=0&q=cotton" \
 *   -H "Authorization: Bearer <ADMIN_API_KEY>" \
 *   -H "Content-Type: application/json"
 *
 * fetch (browser / server)
 * await fetch("/admin/inventory-items/raw-materials?limit=5&offset=0&q=cotton", {
 *   method: "GET",
 *   headers: { "Authorization": "Bearer <ADMIN_API_KEY>" }
 * });
 *
 * axios (node / browser)
 * await axios.get("/admin/inventory-items/raw-materials", {
 *   params: { limit: 5, offset: 0, q: "cotton" },
 *   headers: { "Authorization": "Bearer <ADMIN_API_KEY>" }
 * });
 *
 * Notes:
 *   - The route uses validated query middleware; supply `filters` or `q` through that schema.
 *   - Middleware may set `req.remoteQueryConfig.fields` to limit returned raw-material fields.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getAllInventoryWithRawMaterial, RawMaterialAllowedFields } from "../[id]/rawmaterials/helpers";
import type { ListInventoryItemRawMaterialsQuery } from "./validators";

interface QueryParams {
  limit?: string;
  offset?: string;
  [key: string]: any;
}

export const GET = async (
  req: MedusaRequest & {
    remoteQueryConfig?: {
      fields?: RawMaterialAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  // Use validatedQuery from middleware schema
  const qv = ((req as any).validatequery ?? (req as any).validatedQuery) as Partial<ListInventoryItemRawMaterialsQuery> | undefined
  const limit = Number(qv?.limit ?? 10)
  const offset = Number(qv?.offset ?? 0)
  // Build filters to pass into helper. Helper understands `q` inside the filters object.
  const filters = {
    ...(qv?.filters || {}),
    ...(qv?.q ? { q: qv.q } : {}),
  } as Record<string, unknown>

  const inventoryWithRawMaterials = await getAllInventoryWithRawMaterial(
    req.scope,
    filters,
    req.remoteQueryConfig?.fields || ["*"],
  );

  const total = inventoryWithRawMaterials.length
  const paginated = inventoryWithRawMaterials.slice(offset, offset + limit)

  res.status(200).json({
    inventory_items: paginated,
    count: total,
    offset,
    limit,
  });
}