import { MEDIA_MODULE } from "../../modules/media"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import type SocialProviderService from "../../modules/social-provider/service"
import { uploadAndOrganizeMediaWorkflow } from "../media/upload-and-organize-media"
import { listSingleDesignsWorkflow } from "../designs/list-single-design"
import { updateDesignWorkflow } from "../designs/update-design"

/**
 * Find or create a media folder for a partner's WhatsApp media.
 * Folder name: "WhatsApp — <partnerName>"
 */
export async function getOrCreatePartnerMediaFolder(
  scope: any,
  partnerId: string,
  partnerName: string
): Promise<string> {
  const mediaService = scope.resolve(MEDIA_MODULE) as any

  const slug = `whatsapp-${partnerId}`

  // Check if folder already exists
  const [existing] = await mediaService.listFolders({ slug }, { take: 1 })
  if (existing?.id) return existing.id

  // Create folder
  const folder = await mediaService.createFolders({
    name: `WhatsApp — ${partnerName}`,
    slug,
    path: `/${slug}`,
    level: 0,
    sort_order: 0,
    is_public: false,
    metadata: { partner_id: partnerId, source: "whatsapp" },
  })

  return folder.id
}

/**
 * Download media from Meta's WhatsApp API and save to the partner's media folder.
 * Returns the permanent file URL stored in our system.
 */
export async function downloadAndSaveWhatsAppMedia(
  scope: any,
  options: {
    mediaId: string
    mediaUrl?: string
    mimeType?: string
    partnerId: string
    partnerName: string
    caption?: string
  }
): Promise<{ fileUrl: string; mimeType: string } | null> {
  const socialProvider = scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
  const whatsapp = socialProvider.getWhatsApp(scope)

  try {
    // Step 1: Get download URL from Meta if not already provided
    let downloadUrl = options.mediaUrl
    let mimeType = options.mimeType || "application/octet-stream"

    if (!downloadUrl) {
      const mediaInfo = await whatsapp.getMediaUrl(options.mediaId)
      if (!mediaInfo?.url) return null
      downloadUrl = mediaInfo.url
      if (mediaInfo.mime_type) mimeType = mediaInfo.mime_type
    }

    // Step 2: Download the binary
    const downloaded = await whatsapp.downloadMedia(downloadUrl)
    if (!downloaded) return null

    mimeType = downloaded.contentType || mimeType

    // Step 3: Get or create the partner's media folder
    const folderId = await getOrCreatePartnerMediaFolder(
      scope,
      options.partnerId,
      options.partnerName
    )

    // Step 4: Generate filename
    const ext = extensionFromMime(mimeType)
    const timestamp = Date.now()
    const filename = `wa-${timestamp}${ext}`

    // Step 5: Upload via media workflow
    const { result } = await uploadAndOrganizeMediaWorkflow(scope).run({
      input: {
        files: [{
          filename,
          mimeType,
          content: downloaded.buffer.toString("binary"),
        }],
        existingFolderId: folderId,
        metadata: {
          source: "whatsapp",
          partner_id: options.partnerId,
          wa_media_id: options.mediaId,
          caption: options.caption,
        },
      },
    })

    // Extract the URL from the result
    const mediaFiles = (result as any)?.mediaFiles || (result as any)
    const firstFile = Array.isArray(mediaFiles) ? mediaFiles[0] : mediaFiles
    const fileUrl = firstFile?.file_path || firstFile?.url || null

    if (!fileUrl) return null

    return { fileUrl, mimeType }
  } catch (e: any) {
    console.error("[whatsapp-media] Failed to download/save media:", e.message)
    return null
  }
}

export type RunMediaAttachResult =
  | { ok: true; runId: string; designId: string; fileUrl: string }
  | { ok: false; reason: "run_not_found" | "not_partner_run" | "not_started" | "terminal_state" | "no_design" | "attach_failed"; detail?: string }

/**
 * Attach an already-uploaded media file to the design linked to a
 * production run. Mirrors the guard logic in
 * src/api/partners/production-runs/[id]/media/attach/route.ts so the
 * WhatsApp path honors the same "between start and complete" window.
 *
 * Gates (all must hold):
 *   - run exists
 *   - run.partner_id === partnerId
 *   - run.status === "in_progress"
 *   - run.started_at is set (work has actually begun)
 *   - run is not cancelled / completed
 *   - run has a design linked
 */
export async function attachMediaToRunDesign(
  scope: any,
  options: {
    runId: string
    partnerId: string
    fileUrl: string
    fileId?: string
  }
): Promise<RunMediaAttachResult> {
  const productionRunService = scope.resolve(PRODUCTION_RUNS_MODULE) as ProductionRunService

  let run: any
  try {
    run = await productionRunService.retrieveProductionRun(options.runId)
  } catch {
    return { ok: false, reason: "run_not_found" }
  }

  if (run.partner_id !== options.partnerId) {
    return { ok: false, reason: "not_partner_run" }
  }
  if (run.status === "cancelled" || run.status === "completed") {
    return { ok: false, reason: "terminal_state", detail: String(run.status) }
  }
  if (!run.started_at || run.status !== "in_progress") {
    return { ok: false, reason: "not_started" }
  }
  const designId = run.design_id as string | undefined
  if (!designId) {
    return { ok: false, reason: "no_design" }
  }

  try {
    const { result: currentDesign } = await listSingleDesignsWorkflow(scope).run({
      input: { id: designId, fields: ["*"] },
    })

    const existing: any[] = (currentDesign as any)?.media_files || []

    // Dedup by file id first (strongest), then by url
    const already = existing.some((m: any) => {
      if (options.fileId && m?.id === options.fileId) return true
      return m?.url === options.fileUrl
    })
    const nextMedia = already
      ? existing
      : [
          ...existing,
          {
            id: options.fileId,
            url: options.fileUrl,
            isThumbnail: false,
            source: "whatsapp",
            run_id: options.runId,
          },
        ]

    const { errors } = await updateDesignWorkflow(scope).run({
      input: {
        id: designId,
        media_files: nextMedia,
      },
    })

    if (errors?.length) {
      return { ok: false, reason: "attach_failed", detail: errors.map((e: any) => e?.error?.message || String(e)).join(", ") }
    }

    return { ok: true, runId: options.runId, designId, fileUrl: options.fileUrl }
  } catch (e: any) {
    return { ok: false, reason: "attach_failed", detail: e?.message }
  }
}

function extensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/3gpp": ".3gp",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  }
  return map[mimeType] || ""
}
