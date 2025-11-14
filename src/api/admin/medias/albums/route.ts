import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { listAlbumWorkflow } from "../../../../workflows/media/list-album";

/**
 * GET /admin/medias/albums
 * List all albums (lightweight for dropdowns)
 */
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
