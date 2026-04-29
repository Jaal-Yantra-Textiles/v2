import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MEDIA_MODULE } from "../../modules/media"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import type SocialProviderService from "../../modules/social-provider/service"
import { uploadAndOrganizeMediaWorkflow } from "../media/upload-and-organize-media"
import { listSingleDesignsWorkflow } from "../designs/list-single-design"
import { updateDesignWorkflow } from "../designs/update-design"

export type PartnerSharedFolder = {
  id: string
  name: string
  slug: string
  fileCount: number
  // Epoch ms of the most recent file in this folder; 0 when empty.
  // Used for ordering ("most-recently-active first").
  latestFileAt: number
}

/**
 * List every folder shared with the partner via their linked people,
 * with file counts and the latest file timestamp per folder. Sorted
 * with the most-recently-active folder first; empty folders sink to
 * the bottom in alphabetical order.
 *
 * Centralized so the resolver (silent-upload destination) and the
 * `folders` WhatsApp command share one query. Adding sharing semantics
 * later (e.g. ACL filtering) only needs to change this function.
 */
export async function listPartnerSharedFolders(
  scope: any,
  partnerId: string,
): Promise<PartnerSharedFolder[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: partnerData } = await query.graph({
    entity: "partners",
    fields: ["people.id"],
    filters: { id: partnerId },
  } as any)
  const personIds: string[] = ((partnerData?.[0] as any)?.people ?? [])
    .map((p: any) => p?.id)
    .filter(Boolean)
  if (!personIds.length) return []

  const { data: personData } = await query.graph({
    entity: "person",
    fields: [
      "id",
      "folders.id",
      "folders.name",
      "folders.slug",
      "folders.media_files.id",
      "folders.media_files.created_at",
    ],
    filters: { id: personIds },
  } as any)

  // Dedup folders that show up under multiple people; track best-of stats.
  const byFolder = new Map<string, PartnerSharedFolder>()
  for (const person of personData ?? []) {
    for (const folder of (person as any).folders ?? []) {
      if (!folder?.id) continue
      const files = (folder as any).media_files ?? []
      const fileCount = files.length
      const latest = files
        .map((f: any) => (f?.created_at ? Date.parse(f.created_at) : 0))
        .reduce((a: number, b: number) => (b > a ? b : a), 0)
      const prev = byFolder.get(folder.id)
      if (!prev) {
        byFolder.set(folder.id, {
          id: folder.id,
          name: folder.name,
          slug: folder.slug,
          fileCount,
          latestFileAt: latest,
        })
      } else if (latest > prev.latestFileAt) {
        prev.latestFileAt = latest
        // fileCount may differ between persons if filters ever diverge;
        // pick the larger so the partner sees what's actually there.
        if (fileCount > prev.fileCount) prev.fileCount = fileCount
      }
    }
  }

  return [...byFolder.values()].sort((a, b) => {
    if (b.latestFileAt !== a.latestFileAt) return b.latestFileAt - a.latestFileAt
    return a.name.localeCompare(b.name)
  })
}

/**
 * Pick the partner's most active shared folder. Used by the WhatsApp
 * inbound-media path: when a partner sends a photo outside any run
 * context, we want it to land in their actual working folder rather
 * than the per-partner WhatsApp catchall, so the admin doesn't have
 * to move files around. "Most recent" beats "first alphabetical"
 * because it tracks what the partner is actively collaborating on.
 */
export async function resolvePartnerDefaultSharedFolder(
  scope: any,
  partnerId: string,
): Promise<{ id: string; name: string; slug: string } | null> {
  const folders = await listPartnerSharedFolders(scope, partnerId)
  if (!folders.length) return null
  const winner = folders[0]
  return { id: winner.id, name: winner.name, slug: winner.slug }
}

export type PartnerOpenWork = {
  pendingRuns: Array<{
    id: string
    status: string
    accepted: boolean
    designName?: string
  }>
  pendingPayments: Array<{
    id: string
    status: string
    totalAmount?: number | null
    currency?: string | null
    submittedAt?: string | null
  }>
}

/**
 * Aggregate everything a partner has open right now. Used by the
 * WhatsApp `open` command to give partners a single read of their
 * pending work without having to remember the separate `runs` and
 * payment commands. Designs are excluded for v1 — the design ↔
 * partner link is many-to-many with computed status, so the query
 * is heavier and the production-run row already covers most active
 * design work in practice.
 */
export async function getPartnerOpenWork(
  scope: any,
  partnerId: string,
): Promise<PartnerOpenWork> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const runsPromise = query
    .graph({
      entity: "production_runs",
      fields: ["id", "status", "accepted_at", "design.name"],
      filters: {
        partner_id: partnerId,
        status: { $in: ["sent_to_partner", "in_progress"] },
      },
      pagination: { skip: 0, take: 25 },
    } as any)
    .then(({ data }: any) =>
      (data ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        accepted: !!r.accepted_at,
        designName: r.design?.name,
      })),
    )
    .catch(() => [])

  // Status casing varies across handler code (see whatsapp-admin-handler
  // using lowercase "pending"); the model itself defines a TitleCase enum
  // including Draft / Pending / Under_Review. Match both shapes so the
  // command works regardless of how submissions were created.
  const paymentsPromise = query
    .graph({
      entity: "payment_submissions",
      fields: ["id", "status", "total_amount", "currency", "submitted_at"],
      filters: {
        partner_id: partnerId,
        status: {
          $in: [
            "Draft",
            "Pending",
            "Under_Review",
            "draft",
            "pending",
            "under_review",
          ],
        },
      },
      pagination: { skip: 0, take: 25 },
    } as any)
    .then(({ data }: any) =>
      (data ?? []).map((s: any) => ({
        id: s.id,
        status: s.status,
        totalAmount: s.total_amount ?? null,
        currency: s.currency ?? null,
        submittedAt: s.submitted_at ?? null,
      })),
    )
    .catch(() => [])

  const [pendingRuns, pendingPayments] = await Promise.all([
    runsPromise,
    paymentsPromise,
  ])
  return { pendingRuns, pendingPayments }
}

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
    // Override the default per-partner WhatsApp catchall folder. When
    // set, the file is uploaded directly to this folder — used when the
    // partner has a real shared working folder we'd rather route to.
    targetFolderId?: string
  }
): Promise<{ fileUrl: string; mimeType: string; folderId: string } | null> {
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

    // Step 3: Resolve target folder. Prefer the caller-supplied override
    // (a real shared folder); fall back to the per-partner WhatsApp
    // catchall when nothing is shared with the partner yet.
    const folderId = options.targetFolderId
      ?? await getOrCreatePartnerMediaFolder(
        scope,
        options.partnerId,
        options.partnerName
      )

    // Step 4: Generate filename
    const ext = extensionFromMime(mimeType)
    const timestamp = Date.now()
    const filename = `wa-${timestamp}${ext}`

    // Step 5: Upload via media workflow.
    //
    // base64 is required here. The downstream file-s3 provider
    // (@medusajs/file-s3 services/s3-file.js:68-79) format-detects the
    // content string by attempting a base64 round-trip — if that
    // succeeds it decodes as base64; otherwise it falls back to
    // Buffer.from(content, "utf8"). Passing toString("binary") gives
    // it a Latin-1 string of raw bytes that fails the round-trip and
    // takes the utf8 path, which UTF-8-encodes every char >0x7f and
    // lands the file on S3 with mojibake content (12.5MB instead of
    // 8.2MB for a real JPEG, magic bytes c3 bf c3 98 instead of
    // ff d8 ff e0 — file(1) reports "data", browsers fail to render).
    //
    // The admin UI sidesteps all of this by using a multi-part
    // presigned-URL upload (admin/lib/uploads/upload-manager.ts) that
    // PUTs raw binary directly to S3. The webhook path can't easily do
    // that because Meta hands us a Buffer in Node, not a browser File,
    // so we go through the workflow + file-s3 service. base64 is the
    // only encoding that survives that hop. Memory cost: ~33% over
    // the buffer (16 MB Meta cap → ~21 MB string, trivial for Node).
    const { result } = await uploadAndOrganizeMediaWorkflow(scope).run({
      input: {
        files: [{
          filename,
          mimeType,
          content: downloaded.buffer.toString("base64"),
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

    return { fileUrl, mimeType, folderId }
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
