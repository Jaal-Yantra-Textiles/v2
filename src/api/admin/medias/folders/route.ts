
/**
 * GET handler for listing media folders (lightweight payload for dropdowns).
 *
 * Fetches up to 1000 folders using the internal listFolderWorkflow and returns a
 * compact representation suitable for UI dropdowns. The handler selects only
 * the fields: `id`, `name`, `path`, `level`, and `parent_folder_id`.
 *
 * Route: GET /admin/medias/folders
 *
 * @remarks
 * - Uses the request scope (req.scope) to run the `listFolderWorkflow`.
 * - Returns an object with `folders` (array) and `count` (total available).
 *
 * @param req - MedusaRequest: express-like request with scoped container and auth context.
 * @param res - MedusaResponse: express-like response used to send JSON output.
 *
 * @returns A Promise that resolves when the response has been sent (void).
 *
 * @throws {MedusaError} MedusaError.Types.UNEXPECTED_STATE when folder listing fails.
 *
 * @example
 * // Browser / frontend example (fetch)
 * fetch("/admin/medias/folders", {
 *   method: "GET",
 *   headers: { "Content-Type": "application/json" },
 *   credentials: "include" // if auth cookies are required
 * })
 *   .then(res => res.json())
 *   .then(({ folders, count }) => {
 *     // folders: Array<{ id: string, name: string, path: string, level: number, parent_folder_id?: string }>
 *     console.log("folders", folders);
 *     console.log("total count", count);
 *   })
 *   .catch(err => console.error("Failed to load folders", err));
 *
 * @example
 * // Expected JSON response shape
 * {
 *   "folders": [
 *     { "id": "fld_1", "name": "Images", "path": "Images", "level": 0, "parent_folder_id": null },
 *     { "id": "fld_2", "name": "Products", "path": "Images/Products", "level": 1, "parent_folder_id": "fld_1" }
 *   ],
 *   "count": 2
 * }
 *
 * @public
 */
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
