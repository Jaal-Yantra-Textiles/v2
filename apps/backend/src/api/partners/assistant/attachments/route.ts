/**
 * POST /partners/assistant/attachments
 *
 * Upload one or more photos from the partner-assistant composer. Returns the
 * public URLs the model will be told about — the assistant never receives
 * pixels, only `[attachment N] name=… type=… url=…` lines (see ../chat/route).
 *
 * Why this route exists rather than the model driving the upload:
 *   - The browser is the only place the bytes are. Having the model orchestrate
 *     initiate → PUT parts → complete costs 3-4 round trips per photo and makes
 *     it hold upload ids it has no use for.
 *   - The pre-existing `/partners/medias/uploads/*` pair puts objects at the
 *     BUCKET ROOT and writes NO media record, so an uploaded photo is
 *     unattributable the moment the chat ends. Everything here lands in the
 *     partner's own folder with a real `media_file` row.
 *
 * Files arrive as multipart `files` (see middlewares.ts). Content is passed to
 * the workflow as BASE64 — not "binary"/latin1 — because the file provider
 * round-trips it through `Buffer.from(content, "base64")` and silently
 * UTF-8-corrupts every byte >= 0x80 otherwise (#769).
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import fs from "fs"
import { uploadAndOrganizeMediaWorkflow } from "../../../../workflows/media/upload-and-organize-media"
import { getPartnerFromAuthContext } from "../../helpers"
import { ensurePartnerAssistantFolder } from "./folder"

/** Only images — the assistant's vision path cannot do anything with the rest,
 *  and an unreadable attachment is worse than a refused one because the model
 *  will happily describe a file it never saw. */
const ALLOWED_MIME = /^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/i

/** Per-request cap. The composer enforces its own limit; this is the backstop. */
const MAX_FILES = 10

export const POST = async (
  req: AuthenticatedMedusaRequest & { files?: Express.Multer.File[] },
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ message: "Partner authentication required" })
  }

  const uploaded: Express.Multer.File[] = Array.isArray(req.files)
    ? (req.files as Express.Multer.File[])
    : (req as any).file
    ? [(req as any).file as Express.Multer.File]
    : []

  if (!uploaded.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "No files were uploaded")
  }
  if (uploaded.length > MAX_FILES) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Too many files in one request (max ${MAX_FILES}).`
    )
  }

  const rejected = uploaded.filter((f) => !ALLOWED_MIME.test(f.mimetype || ""))
  if (rejected.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Only image uploads are supported. Rejected: ${rejected
        .map((f) => `${f.originalname} (${f.mimetype || "unknown type"})`)
        .join(", ")}`
    )
  }

  const folderId = await ensurePartnerAssistantFolder(req.scope, {
    id: partner.id,
    name: (partner as any).name,
  })

  const conversationId =
    (req.body as any)?.conversation_id ?? (req as any).validatedBody?.conversation_id

  const files = uploaded.map((file) => {
    const buf = (file as any).buffer
    const path = (file as any).path
    const content = Buffer.isBuffer(buf)
      ? buf.toString("base64")
      : typeof path === "string"
      ? fs.readFileSync(path).toString("base64")
      : ""
    return {
      filename: file.originalname,
      mimeType: file.mimetype,
      content,
      ...(typeof path === "string" ? { _tempPath: path } : {}),
    } as any
  })

  try {
    const { result } = await uploadAndOrganizeMediaWorkflow(req.scope).run({
      input: {
        files,
        existingFolderId: folderId,
        metadata: {
          source: "partner_assistant",
          uploaded_by_partner_id: partner.id,
          uploaded_by_partner_name: (partner as any).name ?? null,
          ...(conversationId ? { conversation_id: String(conversationId) } : {}),
        },
      },
    })

    const mediaFiles = (result as any)?.mediaFiles ?? []
    const attachments = mediaFiles.map((m: any) => ({
      media_id: m.id,
      name: m.original_name || m.file_name,
      type: m.mime_type,
      url: m.file_path,
    }))

    // A media row with no usable URL would be handed to the model as
    // `url=undefined`, which it would then "read" — fail loudly instead.
    const urlless = attachments.filter((a: any) => !a.url)
    if (urlless.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Upload stored but no URL was returned for it; not attaching."
      )
    }

    return res.status(201).json({ folder_id: folderId, attachments })
  } finally {
    // Disk-backed multer writes to tmp; clean up regardless of outcome.
    for (const file of uploaded) {
      const p = (file as any).path
      if (typeof p === "string") {
        fs.promises.unlink(p).catch((e) =>
          logger?.debug?.(
            `[partner-assistant/attachments] temp cleanup failed for ${p}: ${e?.message}`
          )
        )
      }
    }
  }
}
