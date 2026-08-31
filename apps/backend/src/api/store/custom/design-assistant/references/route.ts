/**
 * Storefront design-assistant — a maker drops photos in, and a design comes out.
 *
 *   POST /store/custom/design-assistant/references   (multipart: files[])
 *
 * ## Why this exists
 *
 * 🔴 Reference images never left the browser. The client uploaded through
 * `presignDesignImageUpload`, which returns `AUTH_REQUIRED` before making any
 * request when there are no customer auth headers — and the entire design chat
 * is a GUEST flow, identified by an email and nothing else. So every attached
 * photo degraded to `status: "preview"`: an object URL in the tab, rendered as
 * a thumbnail, gone when the tab closed.
 *
 * Everything downstream then looked broken for the wrong reason. There was no
 * public URL, so `references/analyze` had nothing to read, so the analysis
 * "failed", so no `MediaFile` was written and nothing reached the board.
 * Production bears it out exactly: **0 media files have ever carried
 * `metadata.source = "design-reference"`, 0 carry `vision_analysis`, and the
 * designs created from those sessions have `moodboard.elements: 0`.**
 *
 * ⚠️ This is the SECOND place in one feature where a guest flow reached for a
 * customer-authenticated endpoint — the board read was the first. Both
 * degraded quietly instead of failing, which is why neither showed up in a
 * test.
 *
 * ## What it does, and why in this order
 *
 * The maker's opening move is often just photographs — no brief, no garment
 * named. So:
 *
 *   1. resolve the guest customer from the email,
 *   2. **resolve or CREATE the design** — the photos need somewhere to live,
 *      and the design is that place,
 *   3. upload the bytes server-side (`uploadFilesWorkflow`), which is what
 *      removes the client-side presign and therefore the auth wall,
 *   4. analyse each image,
 *   5. pin them onto the design's moodboard as inspiration elements.
 *
 * The analysis comes back with the photos so the assistant's NEXT question can
 * be about what it can actually see, rather than asking a maker who has just
 * uploaded five pictures of a jacket what they would like to design.
 *
 * Public and email-scoped, matching the rest of this mount (conversations,
 * pick, the board read).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"

import designCustomerLink from "../../../../../links/design-customer-link"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import {
  appendInspirationElements,
  normalizeCanvasScene,
} from "../../../../../modules/designs/lib/canvas-scene"
import { analyzeReferenceImages } from "../../../../../mastra/agents/tools/storefront-design-analysis"
import { runEnsureGuestCustomer } from "../../../../../mastra/agents/tools/storefront-design-flow"
import { createDesignWorkflow } from "../../../../../workflows/designs/create-design"

/** Images only. A maker's "reference" is a picture, and nothing here reads a PDF. */
const ALLOWED = /^image\/(png|jpe?g|webp|gif|avif|heic|heif)$/i
const MAX_FILES = 8

export const POST = async (
  req: MedusaRequest & { files?: Express.Multer.File[] },
  res: MedusaResponse
) => {
  const body = (req.body ?? {}) as Record<string, any>
  const email = String(body.customer_email ?? "").trim().toLowerCase()

  if (!email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "customer_email is required — references are saved against the maker's designs."
    )
  }

  const files = (Array.isArray(req.files) ? req.files : []).filter((f) =>
    ALLOWED.test(f?.mimetype ?? "")
  )

  if (!files.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Attach at least one image."
    )
  }
  if (files.length > MAX_FILES) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Attach at most ${MAX_FILES} images at a time.`
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { customer_id } = await runEnsureGuestCustomer(req.scope as any, email)

  // ── 1. Resolve or create the design the photos belong to ────────────────
  let designId = String(body.design_id ?? "").trim() || null
  let createdDesign = false

  if (designId) {
    // 🔴 Ownership, not just existence. A design id in a public body is a
    // string anyone can type; without this, photos could be pinned onto
    // someone else's board.
    const { data: links = [] } = await query.graph({
      entity: designCustomerLink.entryPoint,
      fields: ["design_id", "customer_id"],
      filters: { design_id: designId, customer_id },
    })
    if (!links?.length) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Design not found")
    }
  } else {
    /**
     * No design yet — this IS the opening move. Named from the upload rather
     * than left blank, because "Untitled" is what the maker will see on their
     * board before the assistant has asked them anything.
     *
     * 🔑 Deliberately NOT inferring a `product_type` here. That field is
     * load-bearing — the production spec and the cost estimate derive from it
     * — and guessing "jacket" from a filename would put a wrong,
     * confident-looking value where `save_brief` belongs. The analysis below
     * gives the assistant what it needs to ASK.
     */
    const { result, errors } = await createDesignWorkflow(req.scope as any).run({
      input: {
        name: String(body.name ?? "").trim() || "New design from your photos",
        description: "",
        design_type: "Custom",
        status: "Conceptual",
        origin_source: "ai-other",
        customer_id_for_link: customer_id,
        tags: ["custom", "customer-design", "chat-editor"],
      } as any,
    })
    if (errors?.length) throw errors[0]
    designId = (result as any).id
    createdDesign = true
  }

  // ── 2. Upload the bytes SERVER-SIDE ─────────────────────────────────────
  const uploaded: Array<{ url: string; name: string }> = []
  for (const file of files) {
    const out = await uploadFilesWorkflow(req.scope as any).run({
      input: {
        files: [
          {
            filename: file.originalname,
            mimeType: file.mimetype,
            content: file.buffer.toString("binary"),
            access: "public" as const,
          },
        ],
      },
    })
    const result: any = out.result
    const arr = Array.isArray(result) ? result : (result?.files ?? [])
    const url = arr?.[0]?.url ?? arr?.[0]?.location
    if (url) uploaded.push({ url, name: file.originalname })
  }

  if (!uploaded.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The images could not be stored."
    )
  }

  // ── 3. Analyse, then 4. pin to the board ────────────────────────────────
  // Analysis is best-effort by construction: a picture that cannot be read is
  // still the maker's picture and still belongs on their board.
  const analyses = await analyzeReferenceImages(
    req.scope as any,
    uploaded.map((u) => u.url)
  ).catch(() => new Map())

  const references = uploaded.map((u) => {
    const a: any = analyses.get(u.url) ?? null
    return {
      url: u.url,
      name: u.name,
      media_id: a?.media_id ?? null,
      analysis: a
        ? {
            title: a.title ?? "",
            description: a.description ?? "",
            suggestions: a.suggestions ?? [],
            analyzed_at: a.analyzed_at ?? null,
          }
        : null,
    }
  })

  const designService: any = req.scope.resolve(DESIGN_MODULE)
  const design = await designService.retrieveDesign(designId).catch(() => null)

  const scene = appendInspirationElements(
    normalizeCanvasScene(design?.moodboard),
    references
  )

  /**
   * The design's GALLERY, as well as the chat board.
   *
   * 🔑 Two different surfaces, and the photos belong on both. `moodboard` is
   * the Excalidraw scene the chat's board panel renders; `media_files` is the
   * `{ id, url, isThumbnail }` gallery the admin design page and the design
   * detail read. Writing only the scene would leave a design whose photos are
   * visible in the chat and invisible everywhere the business looks at it.
   *
   * Appended and deduped by url — `media_files` already holds anything the
   * production-run attach path put there, and replacing the array would drop
   * it. Same reason `metadata` writes have hurt elsewhere: a shared bag with
   * more than one writer.
   */
  const existingMedia: any[] = Array.isArray(design?.media_files)
    ? (design!.media_files as any[])
    : []
  const seenUrls = new Set(existingMedia.map((m) => m?.url).filter(Boolean))
  const media_files = [
    ...existingMedia,
    ...references
      .filter((r) => !seenUrls.has(r.url))
      .map((r) => ({
        ...(r.media_id ? { id: r.media_id } : {}),
        url: r.url,
        isThumbnail: false,
      })),
  ]

  await designService
    .updateDesigns({ id: designId, moodboard: scene as any, media_files })
    .catch(() => {
      // The photos are uploaded and analysed; a write failure here must not
      // lose them. The client still receives the analysis.
    })

  return res.status(201).json({
    design_id: designId,
    created_design: createdDesign,
    references,
  })
}
