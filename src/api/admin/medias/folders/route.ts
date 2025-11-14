import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { listFolderWorkflow } from "../../../../workflows/media/list-folder";

/**
 * GET /admin/medias/folders
 * List all folders (lightweight for dropdowns)
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const { result } = await listFolderWorkflow(req.scope).run({
      input: {
        filters: {},
        config: {
          select: ["id", "name", "path", "level", "parent_folder_id"],
          take: 1000, // Get all folders for dropdown
        },
      },
    });

    const folders = result[0] || [];
    
    res.status(200).json({
      folders,
      count: result[1] || folders.length,
    });
  } catch (error) {
    console.error("Error listing folders:", error);
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to list folders"
    );
  }
};
