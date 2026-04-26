
/**
 * HTTP GET handler to fetch detailed information for a media folder by ID.
 *
 * Invokes the getFolderDetailWorkflow with the current request scope and a
 * configuration that loads the folder's parent, children and media files.
 *
 * Behavior:
 * - Extracts `id` from `req.params`.
 * - Runs the workflow: getFolderDetailWorkflow(req.scope).run({ input: { id, config } }).
 * - If the workflow returns errors, responds with HTTP 500 and an error payload.
 * - On success, responds with HTTP 200 and the workflow result as JSON.
 *
 * @param req - MedusaRequest with route params containing `{ id: string }`.
 * @param res - MedusaResponse used to send JSON responses and status codes.
 *
 * @returns A JSON response with the folder detail on success, or an error object on failure.
 *
 * @remarks
 * The workflow is invoked with relations: ["parent_folder", "child_folders", "media_files"].
 *
 * @example
 * // Client-side usage (browser / node-fetch)
 * fetch('/admin/medias/folder/01A2B3C/detail', { method: 'GET' })
 *   .then(res => {
 *     if (!res.ok) throw new Error('Failed to fetch folder detail')
 *     return res.json()
 *   })
 *   .then(data => console.log('Folder detail', data))
 *   .catch(err => console.error(err))
 *
 * @example
 * // Successful response shape (illustrative)
 * // {
 * //   id: "01A2B3C",
 * //   name: "Product Images",
 * //   parent_folder: { id: "ROOT", name: "Media" },
 * //   child_folders: [{ id: "CH1", name: "Thumbnails" }],
 * //   media_files: [{ id: "MF1", url: "https://..." }],
 * //   metadata: { ... }
 * // }
 *
 * @example
 * // Error response shape (illustrative)
 * // res.status(500).json({
 * //   message: "Failed to fetch folder detail",
 * //   errors: [{ code: "WORKFLOW_ERROR", message: "..." }]
 * // })
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getFolderDetailWorkflow } from "../../../../../../workflows/media/get-folder-detail"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id: string }

  const { result, errors } = await getFolderDetailWorkflow(req.scope).run({
    input: {
      id,
      config: {
        relations: ["parent_folder", "child_folders", "media_files"],
      },
    },
  })

  if (errors?.length) {
    return res.status(500).json({ message: "Failed to fetch folder detail", errors })
  }

  return res.json({
    ...result,
  })
}
