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
 *   1. resolve the maker — the SIGNED-IN customer (#2543 phase 2),
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
 * Public. 🔴 #2543: pinning onto an EXISTING design needs that design's access
 * token (`x-design-token` header or a `design_token` form field) or a signed-in
 * customer linked to it. A NEW design is only made for a signed-in customer
 * (#2543 phase 2 — an email typed into a public form proved nothing, and
 * filed designs under any address); without a session and without a design
 * the route answers 401 `sign_in_required` and creates nothing. A new
 * design's token is returned.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  assertDesignAccess,
  readDesignCredentials,
} from "../../../../../lib/design-access/authorize"
import { mintDesignAccessToken } from "../../../../../lib/design-access/token"
import {
  analyzeStoredReferences,
  encodeUploadContent as encodeContent,
  pinReferencesToDesign,
  storeReferenceFiles,
} from "../../../../../lib/design-references/pin-references"
import {
  resolveOrCreateStudioDesignForCustomer,
  SIGN_IN_REQUIRED_MESSAGE,
} from "../../../../../mastra/agents/tools/storefront-design-flow"

/** Images only. A maker's "reference" is a picture, and nothing here reads a PDF. */
const ALLOWED = /^image\/(png|jpe?g|webp|gif|avif|heic|heif)$/i
const MAX_FILES = 8

/**
 * Encode a multer file's bytes for `uploadFilesWorkflow`.
 *
 * 🔴 base64, NOT "binary"/latin1 (#1759). The Medusa file provider
 * (local-file / file-s3) format-detects the content string by attempting a
 * base64 round-trip — if that succeeds it decodes as base64; otherwise it
 * falls back to `Buffer.from(content, "utf8")`, which UTF-8-re-encodes every
 * byte >= 0x80 and corrupts real images (magic bytes c3 bf c3 98 instead of
 * ff d8 ff e0 — the upload still SUCCEEDS, the stored file is just mojibake,
 * which is why no status assertion can catch it). Same failure mode #769
 * fixed on the admin media routes; see
 * workflows/whatsapp/whatsapp-media-helper.ts for the full autopsy.
 */
export const encodeUploadContent = encodeContent

export const POST = async (
  req: MedusaRequest & { files?: Express.Multer.File[] },
  res: MedusaResponse
) => {
  const body = (req.body ?? {}) as Record<string, any>

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

  const credentials = readDesignCredentials(req)

  // ── 1. Resolve or create the design the photos belong to ────────────────
  let designId = String(body.design_id ?? "").trim() || null
  let createdDesign = false
  let designToken: string | null = null

  if (designId) {
    // 🔴 Ownership, not just existence — and not an email (#2543). A design id
    // in a public body is a string anyone can type; without this, photos could
    // be pinned onto someone else's board. Checked before the guest customer
    // is resolved, so a denied call creates nothing.
    const grant = await assertDesignAccess(req.scope as any, designId, credentials)
    designToken =
      grant.via === "token" && credentials.token
        ? credentials.token
        : mintDesignAccessToken(designId, grant.customer_id)
  }

  // 🔴 #2543 phase 2: a NEW design belongs to the signed-in customer, never to
  // a guest customer conjured from a typed `customer_email`.
  const customer_id = credentials.customerId
  if (!designId && !customer_id) {
    res.status(401).json({
      code: "sign_in_required",
      sign_in_required: true,
      message: SIGN_IN_REQUIRED_MESSAGE,
    })
    return
  }

  if (!designId && customer_id) {
    /**
     * No design id supplied — but that does not mean there is no design.
     *
     * 🔴 #1689: the chat mints a design the moment the brief is locked, and
     * the CLIENT only learns its id by reading the finished turn's tool
     * output. A maker who drags photos in before that has landed sends no
     * `design_id`, and minting here would put a SECOND design beside the one
     * they are talking to. Their open chat design wins; only when there is
     * none is a new one made (named from the upload, not left "Untitled").
     *
     * 🔴 #2543: only for a SIGNED-IN customer — a guest typing an email got a
     * stranger's open board (and a token for it).
     */
    const resolved = await resolveOrCreateStudioDesignForCustomer(
      req.scope as any,
      customer_id,
      String(body.name ?? "")
    )
    designId = resolved.design_id
    designToken = resolved.design_token
    createdDesign = resolved.created
  }

  // ── 2. Upload the bytes SERVER-SIDE ─────────────────────────────────────
  const uploaded = await storeReferenceFiles(
    req.scope as any,
    files.map((file) => ({
      filename: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    }))
  )

  if (!uploaded.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The images could not be stored."
    )
  }

  // ── 3. Analyse, then 4. pin to the board + the design's gallery ────────
  // Shared with the chat's add_reference_link — see lib/design-references.
  // A failed design write does not lose the photos: they are stored and
  // analysed, and the client still receives the analysis.
  const references = await analyzeStoredReferences(req.scope as any, uploaded)
  await pinReferencesToDesign(req.scope as any, designId as string, references)

  return res.status(201).json({
    design_id: designId,
    design_token: designToken,
    created_design: createdDesign,
    references,
  })
}
