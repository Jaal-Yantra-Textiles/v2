/**
 * @file Store API routes for raw materials
 * @description Provides endpoints for customers to browse available raw materials for customization
 * @module API/Store/RawMaterials
 */

/**
 * @typedef {Object} StoreRawMaterialsQuery
 * @property {string} [limit=20] - Number of items to return (default: 20)
 * @property {string} [offset=0] - Pagination offset (default: 0)
 * @property {string} [q] - Search query for filtering raw materials
 */

/**
 * @typedef {Object} RawMaterialMedia
 * @property {string} url - URL of the media file
 * @property {boolean} [isThumbnail] - Whether this is the thumbnail image
 */

/**
 * @typedef {Object} InventoryItemSummary
 * @property {string} id - The inventory item ID
 * @property {string} title - Title of the inventory item
 * @property {string} sku - SKU of the inventory item
 */

/**
 * @typedef {Object} RawMaterialResponse
 * @property {string} id - The raw material ID
 * @property {string} name - Name of the raw material
 * @property {string} color - Color of the raw material
 * @property {string} composition - Material composition
 * @property {string} material_type - Type of material (e.g., fabric, leather)
 * @property {RawMaterialMedia[]} media - Array of media files
 * @property {InventoryItemSummary} inventory_item - Associated inventory item
 */

/**
 * @typedef {Object} RawMaterialsListResponse
 * @property {RawMaterialResponse[]} raw_materials - Array of raw materials
 * @property {number} count - Total count of raw materials
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Number of items per page
 */

/**
 * List raw materials available for customization
 * @route GET /store/custom/raw-materials
 * @group Raw Materials - Operations related to raw materials
 * @param {string} [limit=20] - Number of items to return
 * @param {string} [offset=0] - Pagination offset
 * @param {string} [q] - Search query for filtering
 * @returns {RawMaterialsListResponse} 200 - Paginated list of raw materials
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /store/custom/raw-materials?limit=10&offset=0&q=cotton
 *
 * @example response 200
 * {
 *   "raw_materials": [
 *     {
 *       "id": "mat_123456789",
 *       "name": "Premium Cotton Fabric",
 *       "color": "white",
 *       "composition": "100% cotton",
 *       "material_type": "fabric",
 *       "media": [
 *         {
 *           "url": "https://example.com/images/cotton-white.jpg",
 *           "isThumbnail": true
 *         },
 *         {
 *           "url": "https://example.com/images/cotton-white-closeup.jpg"
 *         }
 *       ],
 *       "inventory_item": {
 *         "id": "inv_987654321",
 *         "title": "Cotton Fabric Roll",
 *         "sku": "FAB-COT-001"
 *       }
 *     }
 *   ],
 *   "count": 1,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
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
