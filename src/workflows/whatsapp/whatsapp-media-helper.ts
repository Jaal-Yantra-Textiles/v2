import { MEDIA_MODULE } from "../../modules/media"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import type SocialProviderService from "../../modules/social-provider/service"
import { uploadAndOrganizeMediaWorkflow } from "../media/upload-and-organize-media"

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
