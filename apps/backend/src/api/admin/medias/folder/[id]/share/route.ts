
/**
 * Ensures a folder with the given ID exists and returns it.
 *
 * - Validates that an ID was provided and throws a MedusaError of type INVALID_DATA if not.
 * - Runs the getFolderWorkflow to load the folder with the `parent_folder` relation.
 * - If the workflow returns errors or no result, throws a MedusaError of type NOT_FOUND.
 *
 * @param scope - The request/service scope used to resolve workflows and services (typically req.scope).
 * @param id - The folder ID to ensure exists.
 * @returns The found folder (exact shape depends on repository/workflow result).
 *
 * @throws {MedusaError} INVALID_DATA if id is missing.
 * @throws {MedusaError} NOT_FOUND if the folder cannot be found.
 *
 * @example
 * // Within an express-like route handler:
 * const folder = await ensureFolder(req.scope, "folder_123");
 *
 * @example
 * // Guard usage:
 * try {
 *   const folder = await ensureFolder(scope, folderId);
 *   // proceed with folder
 * } catch (err) {
 *   // handle missing/invalid folder
 * }
 */
 
/**
 * Updates a folder's sharing state and metadata via the updateFolderWorkflow.
 *
 * - Calls updateFolderWorkflow with the given input payload.
 * - If the workflow returns errors, throws a MedusaError of type UNEXPECTED_STATE containing combined error messages.
 * - Returns the workflow result (the updated folder).
 *
 * @param scope - The request/service scope used to resolve workflows and services (typically req.scope).
 * @param input - Update payload:
 *   - id: string — the folder ID to update.
 *   - is_public: boolean — whether the folder should be public/shared.
 *   - metadata: Record<string, any> | null — new metadata to set on the folder (use null to clear metadata).
 * @returns The updated folder object from the workflow.
 *
 * @throws {MedusaError} UNEXPECTED_STATE when the update workflow returns errors.
 *
 * @example
 * const updated = await updateFolderShareState(req.scope, {
 *   id: "folder_123",
 *   is_public: true,
 *   metadata: { share_token: "abc123" },
 * });
 *
 * @example
 * // To clear metadata entirely:
 * await updateFolderShareState(scope, { id: "folder_123", is_public: false, metadata: null });
 */
 
/**
 * POST /admin/medias/folder/:id/share
 *
 * Creates a share token for a folder and marks it as public.
 *
 * Behavior:
 * - Validates the folder exists via ensureFolder.
 * - Generates a random 16-byte hex token and stores it in folder.metadata.share_token.
 * - Sets folder.is_public to true via updateFolderShareState.
 * - Returns 200 with { folder: updatedFolder, share_token: string }.
 *
 * @param req - MedusaRequest; expects req.params.id and req.scope.
 * @param res - MedusaResponse; response will be sent with status 200 on success.
 *
 * @returns HTTP 200 response with JSON: { folder: <updated folder>, share_token: "<token>" }
 *
 * @throws {MedusaError} INVALID_DATA if id missing (propagated from ensureFolder).
 * @throws {MedusaError} NOT_FOUND if folder not found.
 * @throws {MedusaError} UNEXPECTED_STATE if update fails.
 *
 * @example
 * // HTTP request
 * POST /admin/medias/folder/folder_123/share
 *
 * // Successful response
 * {
 *   "folder": { "id": "folder_123", "is_public": true, "metadata": { "share_token": "a1b2c3..." } },
 *   "share_token": "a1b2c3..."
 * }
 */
 
/**
 * DELETE /admin/medias/folder/:id/share
 *
 * Removes the share token from a folder and marks it as not public.
 *
 * Behavior:
 * - Validates the folder exists via ensureFolder.
 * - Removes metadata.share_token (if present). If no other metadata keys remain, sets metadata to null.
 * - Sets folder.is_public to false via updateFolderShareState.
 * - Returns 200 with { folder: updatedFolder }.
 *
 * @param req - MedusaRequest; expects req.params.id and req.scope.
 * @param res - MedusaResponse; response will be sent with status 200 on success.
 *
 * @returns HTTP 200 response with JSON: { folder: <updated folder> }
 *
 * @throws {MedusaError} INVALID_DATA if id missing (propagated from ensureFolder).
 * @throws {MedusaError} NOT_FOUND if folder not found.
 * @throws {MedusaError} UNEXPECTED_STATE if update fails.
 *
 * @example
 * // HTTP request
 * DELETE /admin/medias/folder/folder_123/share
 *
 * // Successful response
 * {
 *   "folder": { "id": "folder_123", "is_public": false, "metadata": null }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import crypto from "crypto"
import { getFolderWorkflow } from "../../../../../../workflows/media/get-folder"
import { updateFolderWorkflow } from "../../../../../../workflows/media/update-folder"

const ensureFolder = async (scope: any, id?: string) => {
  if (!id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Folder ID is required")
  }

  const { result, errors } = await getFolderWorkflow(scope).run({
    input: {
      id,
      config: {
        relations: ["parent_folder"],
      },
    },
  })

  if (errors?.length || !result) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Folder ${id} could not be found`
    )
  }

  return result as any
}

const updateFolderShareState = async (
  scope: any,
  input: { id: string; is_public: boolean; metadata: Record<string, any> | null }
) => {
  const { result, errors } = await updateFolderWorkflow(scope).run({
    input,
  })

  if (errors?.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      errors.map((e) => e.error?.message || "Failed to update folder").join(", ")
    )
  }

  return result
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id?: string }
  const folder = await ensureFolder(req.scope, id)

  const token = crypto.randomBytes(16).toString("hex")
  const metadata = {
    ...(folder.metadata || {}),
    share_token: token,
  }

  const updated = await updateFolderShareState(req.scope, {
    id: folder.id,
    is_public: true,
    metadata,
  })

  return res.status(200).json({ folder: updated, share_token: token })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id?: string }
  const folder = await ensureFolder(req.scope, id)

  const metadata = { ...(folder.metadata || {}) }
  delete metadata.share_token

  const nextMetadata = Object.keys(metadata).length ? metadata : null

  const updated = await updateFolderShareState(req.scope, {
    id: folder.id,
    is_public: false,
    metadata: nextMetadata,
  })

  return res.status(200).json({ folder: updated })
}
