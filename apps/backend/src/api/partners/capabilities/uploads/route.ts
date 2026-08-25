/**
 * POST /partners/capabilities/uploads
 *
 * The photograph half of a capability sample (#1543 / #1531 slice 2).
 *
 * The inquiry wizard has always had a `photo` question kind, and the answer
 * model has always carried `capability_sample_ids` — "the useful part of yes is
 * the photograph proving it". Until now the wizard rendered that question as a
 * sentence apologising for itself: *"Send the photo in your reply and we will
 * attach it here."* So the one question whose answer cannot be typed was the
 * one question that sent the partner back to WhatsApp, which is the exact loop
 * #1531 exists to close.
 *
 * This returns `media_id` + `url` for each file. The caller then creates the
 * sample (`POST /partners/capabilities`) with those ids and attaches the sample
 * to an answer — two steps rather than one, because a sample OUTLIVES the
 * inquiry that produced it and the partner may attach an existing one instead
 * of a new photograph.
 *
 * Files arrive as multipart `files`; content is handed to the workflow as
 * BASE64, not "binary"/latin1 — the file provider round-trips it through
 * `Buffer.from(content, "base64")` and silently UTF-8-corrupts every byte
 * >= 0x80 otherwise (#769).
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import fs from "fs"

import { uploadAndOrganizeMediaWorkflow } from "../../../../workflows/media/upload-and-organize-media"
import { getPartnerFromAuthContext } from "../../helpers"
import { ensurePartnerCapabilityFolder } from "./folder"

/**
 * Images only. A capability sample is evidence somebody LOOKS at — a PDF spec
 * sheet or a video would be stored, listed, and then silently render as a
 * broken thumbnail in every surface that shows the library.
 */
const ALLOWED_MIME = /^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/i

/** Per-request cap. The composer enforces its own; this is the backstop. */
const MAX_FILES = 10

export const POST = async (
  req: AuthenticatedMedusaRequest & { files?: Express.Multer.File[] },
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const uploaded: Express.Multer.File[] = Array.isArray(req.files)
    ? (req.files as Express.Multer.File[])
    : (req as any).file
      ? [(req as any).file as Express.Multer.File]
      : []

  if (!uploaded.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No files were uploaded"
    )
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
      `Only photographs can be attached. Rejected: ${rejected
        .map((f) => `${f.originalname} (${f.mimetype || "unknown type"})`)
        .join(", ")}`
    )
  }

  const folderId = await ensurePartnerCapabilityFolder(req.scope, {
    id: partner.id,
    name: (partner as any).name,
  })

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
          source: "partner_capability",
          uploaded_by_partner_id: partner.id,
          uploaded_by_partner_name: (partner as any).name ?? null,
        },
      },
    })

    const mediaFiles = (result as any)?.mediaFiles ?? []
    const media = mediaFiles.map((m: any) => ({
      media_id: m.id,
      name: m.original_name || m.file_name,
      type: m.mime_type,
      url: m.file_path,
    }))

    /**
     * 🔴 A stored row with no usable URL must fail LOUDLY.
     *
     * The id would be written into `media_file_ids` quite happily, the sample
     * would list, and the library would show an empty square where the evidence
     * is — a capability that reads as photographed and proves nothing. Refusing
     * here costs one retry; accepting it costs the row's credibility for as
     * long as it exists.
     */
    const urlless = media.filter((m: any) => !m.url)
    if (urlless.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The photograph was stored but no URL came back for it, so it has not been attached. Please try again."
      )
    }

    return res.status(201).json({ folder_id: folderId, media })
  } finally {
    // Disk-backed multer writes to tmp; clean up regardless of outcome.
    for (const file of uploaded) {
      const p = (file as any).path
      if (typeof p === "string") {
        fs.promises.unlink(p).catch((e) =>
          logger?.debug?.(
            `[partners/capabilities/uploads] temp cleanup failed for ${p}: ${e?.message}`
          )
        )
      }
    }
  }
}
