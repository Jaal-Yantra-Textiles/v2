/**
 * GET /admin/medias/albums
 *
 * List all albums in a lightweight shape intended for dropdowns and quick lookups.
 *
 * Returns a JSON object with:
 * - albums: Array of album objects containing the selected fields (id, name, type, slug)
 * - count: total number of albums (or fallback to albums.length)
 *
 * Album shape:
 * {
 *   id: string;
 *   name: string;
 *   type: string;
 *   slug: string;
 * }
 *
 * @param req - MedusaRequest: incoming request (scoped container available at req.scope)
 * @param res - MedusaResponse: response object used to send the JSON result
 *
 * @returns 200 - { albums: Album[], count: number }
 *
 * @throws MedusaError.Types.UNEXPECTED_STATE when album listing fails
 *
 * @example Curl
 * curl -X GET "https://api.example.com/admin/medias/albums" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json"
 *
 * Response:
 * {
 *   "albums": [
 *     { "id": "alb_01", "name": "Summer 2023", "type": "public", "slug": "summer-2023" },
 *     { "id": "alb_02", "name": "Product Shots", "type": "private", "slug": "product-shots" }
 *   ],
 *   "count": 2
 * }
 *
 * @example Fetch (browser/node)
 * const res = await fetch("/admin/medias/albums", {
 *   method: "GET",
 *   headers: { "Authorization": "Bearer <ADMIN_TOKEN>" }
 * });
 * if (!res.ok) throw new Error("Failed to fetch albums");
 * const body = await res.json();
 * // body.albums -> Array<{ id, name, type, slug }>
 *
 * @example Internal workflow usage
 * const { result } = await listAlbumWorkflow(scope).run({
 *   input: {
 *     filters: {},
 *     config: { select: ["id", "name", "type", "slug"], take: 1000 }
 *   }
 * });
 * const albums = result[0] || [];
 * const count = result[1] || albums.length;
 * List all albums (lightweight for dropdowns)
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { listAlbumWorkflow } from "../../../../workflows/media/list-album";


export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const { result } = await listAlbumWorkflow(req.scope).run({
      input: {
        filters: {},
        config: {
          select: ["id", "name", "type", "slug"],
          take: 1000, // Get all albums for dropdown
        },
      },
    });

    const albums = result[0] || [];
    
    res.status(200).json({
      albums,
      count: result[1] || albums.length,
    });
  } catch (error) {
    console.error("Error listing albums:", error);
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to list albums"
    );
  }
};
