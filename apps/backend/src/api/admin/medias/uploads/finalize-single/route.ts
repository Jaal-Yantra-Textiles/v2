
/**
 * POST handler to finalize a single S3 multipart/uploaded object into the application's media system.
 *
 * This route consumes a flexible request body (see FinalizeSingleBody) with many accepted aliases for the same
 * properties (e.g. file_key | key | fileKey | path | object_key | objectKey for the uploaded object's key).
 *
 * Behavior:
 * - Extracts required fields from the validated request body (or raw body fallback):
 *   - file_key (required): the object key/path in the storage bucket.
 *   - type (required): MIME/content type of the object.
 *   - size (required): numeric size (will be coerced via Number()).
 * - Accepts optional filename/name; if absent, a deterministic name is generated using the MIME type
 *   (falls back to ".bin").
 * - Constructs a public URL for the file. Priority:
 *   1. FILE_PUBLIC_BASE (recommended) or legacy S3_FILE_URL environment variable (both trimmed of trailing slash)
 *      => `${base}/${file_key}` (file_key trimmed of leading slashes)
 *   2. Fallback to getPublicUrl(file_key).
 * - Delegates finalization to the finalizeS3MediaWorkflow in request scope by invoking .run({
 *     input: { files: [{ key, url, filename, mimeType, size }], existingFolderId, existingAlbumIds, metadata }
 *   }).
 * - On successful workflow run returns HTTP 200 with JSON: { message: "Single upload finalized", result }.
 *
 * Error handling / status codes:
 * - 400 Bad Request: missing/invalid required data (file_key, type, size) — throws MedusaError.Types.INVALID_DATA.
 * - 500 Internal Server Error: unexpected workflow errors or other failures. If the workflow returns errors,
 *   they are aggregated and surfaced as a MedusaError.Types.UNEXPECTED_STATE.
 * - All MedusaError instances are mapped to 400 or 500 depending on error.type. Non-Medusa errors return 500.
 *
 * Notes / caveats:
 * - size is validated via Number.isFinite(Number(body.size)); non-numeric or absent size is rejected.
 * - The handler tolerates multiple naming conventions in the incoming JSON to maximize compatibility with clients.
 * - The route expects that authenticated/authorized middleware and request.scope wiring are present to allow
 *   finalizeS3MediaWorkflow to operate.
 *
 * @param req - MedusaRequest<FinalizeSingleBody> (uses req.validatedBody if present, otherwise req.body)
 * @param res - MedusaResponse used to send JSON response and status codes
 * @returns A Promise resolving to the HTTP response (200 on success, 400/500 on error)
 *
 * @example
 * // Accepted request body shape (aliases supported):
 * // {
 * //   "file_key": "uploads/abc123-part",
 * //   "type": "image/png",
 * //   "size": 12345,
 * //   "name": "avatar.png",
 * //   "existingFolderId": "folder_1",
 * //   "existingAlbumIds": ["album_a"],
 * //   "metadata": { "source": "web" }
 * // }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { finalizeS3MediaWorkflow } from "../../../../../workflows/media/finalize-s3-media"
import { getPublicUrl } from "../s3"

interface FinalizeSingleBody {
  file_key?: string
  key?: string
  fileKey?: string
  path?: string
  object_key?: string
  objectKey?: string
  name?: string
  file_name?: string
  filename?: string
  original_name?: string
  type?: string
  mime_type?: string
  content_type?: string
  size?: number | string
  existingAlbumIds?: string[]
  existingFolderId?: string
  metadata?: Record<string, any>
}

export const POST = async (req: MedusaRequest<FinalizeSingleBody>, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || (req.body as any)
    const file_key: string =
      body?.file_key || body?.key || body?.fileKey || body?.path || body?.object_key || body?.objectKey
    let name: string = body?.name || body?.file_name || body?.filename || body?.original_name
    const type: string = body?.type || body?.mime_type || body?.content_type
    const sizeNum = Number(body?.size)

    if (!name) {
      const extFromType = typeof type === "string" && type.includes("/") ? type.split("/").pop() : "bin"
      name = `upload-${Date.now()}.${extFromType || "bin"}`
    }
    if (!file_key || !type || !Number.isFinite(sizeNum)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Missing required fields: file_key, type, size (name was generated if absent)"
      )
    }

    // Prefer explicit public base URL if configured (custom domain/proxy)
    // 1) FILE_PUBLIC_BASE (recommended): e.g. https://automatic.jaalyantra.com/automatica/file
    // 2) S3_FILE_URL (legacy): base bucket URL
    const base = (process.env.FILE_PUBLIC_BASE || process.env.S3_FILE_URL)?.replace(/\/$/, "")
    const url = base ? `${base}/${file_key.replace(/^\/+/, "")}` : getPublicUrl(file_key)

    const { result, errors } = await finalizeS3MediaWorkflow(req.scope).run({
      input: {
        files: [
          {
            key: file_key,
            url,
            filename: name,
            mimeType: type,
            size: sizeNum,
          },
        ],
        existingFolderId: body?.existingFolderId,
        existingAlbumIds: body?.existingAlbumIds,
        metadata: body?.metadata,
      },
    })

    if (errors.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to finalize media: ${errors.map((e) => e.error?.message || "Unknown").join(", ")}`
      )
    }

    return res.status(200).json({
      message: "Single upload finalized",
      result,
    })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error while finalizing single upload" })
  }
}
