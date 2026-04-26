
/**
 * DELETE request handler to remove a media file by id.
 *
 * This handler expects a route parameter `id` (string) and will run the
 * `deleteMediaFileWorkflow` from the request scope to perform deletion.
 *
 * Behavior:
 * - If `id` is missing, responds with HTTP 400 and a message describing the invalid data error.
 * - If the workflow reports errors, responds with HTTP 500 and an Unexpected State error message.
 * - On success, responds with HTTP 200 and JSON: { id: string, deleted: true }.
 *
 * @param req - MedusaRequest containing route params (`req.params.id`) and DI scope (`req.scope`).
 * @param res - MedusaResponse used to send status and JSON responses.
 *
 * @returns A Promise that resolves after sending the HTTP response. On success, the response body is:
 *   { id: string, deleted: true }
 *
 * @throws {MedusaError} When:
 *   - MedusaError.Types.INVALID_DATA (missing/invalid id) => results in HTTP 400
 *   - MedusaError.Types.UNEXPECTED_STATE (workflow errors) => results in HTTP 500
 *   - Any other unexpected error => results in HTTP 500
 *
 * @example
 * // Client example using fetch (browser / node with fetch)
 * await fetch(`/admin/medias/file/${encodeURIComponent(mediaId)}`, {
 *   method: "DELETE",
 *   headers: {
 *     "Content-Type": "application/json",
 *     "Authorization": `Bearer ${adminJwt}`,
 *   },
 * }).then(async (res) => {
 *   if (res.ok) {
 *     const body = await res.json(); // { id: "...", deleted: true }
 *     console.log("Deleted:", body);
 *   } else {
 *     const err = await res.json();
 *     console.error("Delete failed:", res.status, err.message);
 *   }
 * });
 *
 * @example
 * // Test example using supertest (node)
 * import request from "supertest";
 * await request(app)
 *   .delete(`/admin/medias/file/${mediaId}`)
 *   .set("Authorization", `Bearer ${adminJwt}`)
 *   .expect(200)
 *   .then((res) => {
 *     expect(res.body).toEqual({ id: mediaId, deleted: true });
 *   });
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { deleteMediaFileWorkflow } from "../../../../../workflows/media/delete-media-file"

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params as { id: string }
    if (!id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing media file id")
    }

    const { errors } = await deleteMediaFileWorkflow(req.scope).run({ input: { id } })
    if (errors.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to delete media file: ${errors.map((e) => e.error?.message || "Unknown").join(", ")}`
      )
    }

    return res.status(200).json({ id, deleted: true })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error while deleting media file" })
  }
}
