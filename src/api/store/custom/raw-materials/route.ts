import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getAllInventoryWithRawMaterial, RawMaterialAllowedFields } from "../../../admin/inventory-items/[id]/rawmaterials/helpers";

interface StoreRawMaterialsQuery {
  limit?: string;
  offset?: string;
  q?: string;
}

/**
 * GET /store/custom/raw-materials
 * 
 * Lists all raw materials with their associated inventory items.
 * This is the store-facing equivalent of the admin raw-materials endpoint.
 * Customers can see available fabrics/materials for customization.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const query = req.query as StoreRawMaterialsQuery;
    const limit = Number(query.limit ?? 20);
    const offset = Number(query.offset ?? 0);
    
    // Build filters - support search query
    const filters: Record<string, unknown> = {};
    if (query.q) {
      filters.q = query.q;
    }

    const inventoryWithRawMaterials = await getAllInventoryWithRawMaterial(
      req.scope,
      filters,
      ["*"] as RawMaterialAllowedFields[],
    );

    const total = inventoryWithRawMaterials.length;
    const paginated = inventoryWithRawMaterials.slice(offset, offset + limit);

    // Transform response to be more store-friendly
    const rawMaterials = paginated.map((item: any) => {
      // Transform media from { files: string[] } to Array<{ url: string; isThumbnail?: boolean }>
      let mediaArray: Array<{ url: string; isThumbnail?: boolean }> = [];
      const rawMedia = item.raw_materials?.media;
      
      if (rawMedia) {
        if (rawMedia.files && Array.isArray(rawMedia.files)) {
          // Media stored as { files: string[] }
          mediaArray = rawMedia.files.map((url: string, index: number) => ({
            url,
            isThumbnail: index === 0, // First image is thumbnail
          }));
        } else if (Array.isArray(rawMedia)) {
          // Media already in array format
          mediaArray = rawMedia.map((m: any, index: number) => ({
            url: typeof m === 'string' ? m : m.url,
            isThumbnail: m.isThumbnail ?? index === 0,
          }));
        }
      }
      
      return {
        id: item.raw_materials?.id,
        name: item.raw_materials?.name,
        color: item.raw_materials?.color,
        composition: item.raw_materials?.composition,
        media: mediaArray,
        material_type: item.raw_materials?.material_type,
        inventory_item: {
          id: item.inventory_item?.id,
          title: item.inventory_item?.title,
          sku: item.inventory_item?.sku,
        },
      };
    });

    res.status(200).json({
      raw_materials: rawMaterials,
      count: total,
      offset,
      limit,
    });
  } catch (error) {
    console.error("[Store] Error fetching raw materials:", error);
    res.status(500).json({ 
      message: "Failed to fetch raw materials",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
