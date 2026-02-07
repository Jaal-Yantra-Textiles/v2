
/**
 * POST handler to create a new media folder.
 *
 * This handler expects a validated FolderRequest on req.validatedBody (validated by middleware).
 * It trims the provided name, generates a slug, seeds path/level values, applies defaults, and runs
 * the createFolderWorkflow using the request scope.
 *
 * Behavior:
 * - Trims `name`.
 * - Generates `slug` from name (lowercased, whitespace -> hyphens).
 * - Seeds: `default_sort_order = 0`, `path = "/{slug}"`, `level = 0`.
 * - `default_is_public` is set to provided `is_public` when boolean, otherwise defaults to `true`.
 * - If `parent_folder_id` is present, the workflow recalculates path/level accordingly.
 * - On success responds with 201 and JSON `{ message, folder }`.
 * - If the workflow returns errors, throws MedusaError.Types.UNEXPECTED_STATE with aggregated messages.
 * - Other errors are logged and rethrown.
 *
 * @param req - MedusaRequest<FolderRequest> containing the validated body at `req.validatedBody`.
 * @param res - MedusaResponse used to send the HTTP response.
 * @returns Promise<void> — sends HTTP response on success, otherwise throws.
 * @throws MedusaError.Types.UNEXPECTED_STATE when the workflow reports errors.
 *
 * @example
 * // Client: create a folder via fetch
 * ```js
 * fetch('/admin/medias/folders', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     name: 'Marketing Assets',
 *     is_public: false,
 *     parent_folder_id: null
 *   })
 * });
 * ```
 *
 * @example
 * // Successful response (status 201)
 * ```json
 * {
 *   "message": "Folder created successfully",
 *   "folder": {
 *     "id": "fld_abc123",
 *     "name": "Marketing Assets",
 *     "slug": "marketing-assets",
 *     "path": "/marketing-assets",
 *     "level": 0,
 *     "default_sort_order": 0,
 *     "default_is_public": false,
 *     "parent_folder_id": null,
 *     "created_at": "2025-01-01T12:00:00.000Z"
 *   }
 * }
 * ```
 *
 * @example
 * // Failure scenario: workflow returns errors
 * ```js
 * // The handler will throw a MedusaError:
 * // MedusaError(UNEXPECTED_STATE, 'Failed to create folder: <aggregated error messages>')
 * ```
 */
import {
    MedusaRequest,
    MedusaResponse,
  } from "@medusajs/framework/http";
  import { MedusaError } from "@medusajs/framework/utils";
  import { createFolderWorkflow } from "../../../../workflows/media/create-folder";
import { FolderRequest } from "../validator";

  
  export const POST = async (
    req: MedusaRequest<FolderRequest>,
    res: MedusaResponse
  ) => {
    // Body is validated by middleware (validateAndTransformBody)
    const folderData = req.validatedBody as FolderRequest;
  
    try {
      // Run the create folder workflow
      const name = folderData.name.trim()
      const slug = name.toLowerCase().replace(/\s+/g, "-")
      const { result, errors } = await createFolderWorkflow(req.scope).run({
        input: {
          ...folderData,
          // Generate slug from name
          slug,
          default_sort_order: 0,
          // Respect provided is_public, otherwise default to true
          default_is_public: typeof folderData.is_public === "boolean" ? folderData.is_public : true,
          // Seed path/level; workflow recalculates when parent_folder_id is present
          path: `/${slug}`,
          level: 0,
        },
      });
  
      if (errors.length > 0) {
        console.error("Errors occurred during folder creation:", errors);
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Failed to create folder: ${errors.map(e => e.error?.message || "Unknown error").join(", ")}`
        );
      }
  
      res.status(201).json({
        message: "Folder created successfully",
        folder: result,
      });
    } catch (error) {
      console.error("Error creating folder:", error);
      throw error;
    }
  };
  