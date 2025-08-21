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