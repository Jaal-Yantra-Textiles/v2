
/**
 * GET handler to retrieve a media folder by ID.
 *
 * Validates the `id` path parameter, runs the `getFolderWorkflow` within the request scope,
 * and returns a minimal folder representation (with parent folder relation) by default.
 *
 * Behavior:
 * - If `req.params.id` is missing, throws MedusaError with type INVALID_DATA and returns HTTP 400.
 * - Calls `getFolderWorkflow(req.scope).run({ input: { id, config: { relations: ["parent_folder"] } } })`.
 * - If the workflow returns errors, throws MedusaError with type UNEXPECTED_STATE and returns HTTP 500.
 * - On success returns HTTP 200 with JSON: { folder: result }.
 * - Any non-MedusaError unexpected failure returns HTTP 500 with a generic message.
 *
 * @param req - MedusaRequest; expects `req.params.id` and `req.scope` to be present.
 * @param res - MedusaResponse used to send the HTTP response.
 * @returns A Promise that resolves after sending the HTTP response.
 *
 * @throws {MedusaError} INVALID_DATA when the folder ID is not provided.
 * @throws {MedusaError} UNEXPECTED_STATE when the underlying workflow reports errors.
 *
 * @example
 * // Client request (fetching a folder)
 * // GET /admin/medias/folder/fld_123
 * fetch("/admin/medias/folder/fld_123", { method: "GET" })
 *   .then(res => res.json())
 *   .then(({ folder }) => console.log("Folder:", folder))
 *
 * @example
 * // Expected success response
 * // HTTP 200
 * // { "folder": { "id": "fld_123", "name": "Images", "parent_folder": { "id": "fld_root", "name": "Root" } } }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getFolderWorkflow } from "../../../../../workflows/media/get-folder"

// GET /admin/medias/folder/:id
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params as { id?: string }
    if (!id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Folder ID is required")
    }

    const { result, errors } = await getFolderWorkflow(req.scope).run({
      input: {
        id,
        // keep light by default; UI can call /detail for the composite view
        config: { relations: ["parent_folder"] },
      },
    })

    if (errors?.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to fetch folder: ${errors.map((e) => e.error?.message || "Unknown error").join(", ")}`
      )
    }

    return res.status(200).json({ folder: result })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: "An unexpected error occurred" })
  }
}
