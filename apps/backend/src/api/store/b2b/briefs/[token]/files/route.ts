import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"

import { PARTNER_QUOTE_MODULE } from "../../../../../../modules/partner-quote"
import {
  BRIEF_FILE_MAX_BYTES,
  BRIEF_FILE_MAX_COUNT,
  BRIEF_FILE_TYPES,
} from "../../../../../../modules/partner-quote/lib/brief-answers"
import { buildBriefView } from "../../../../../../modules/partner-quote/lib/brief-view"
import { assertQuoteVisibleToCaller } from "../../../../../../modules/partner-quote/lib/quote-tenant-guard"
import { hashQuoteToken } from "../../../../../../modules/partner-quote/lib/token"

/**
 * #2608 — the buyer uploads artwork to a brief's `file` question.
 *
 * Only through a live, editable brief link and the lead store's key (same
 * guard as the page). Images and PDF only, 10 MB, 10 files per question. The
 * file goes to our file store (S3 on prod) and its URL is appended to the
 * answer HERE: the answers route can only remove files, never add a URL.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const token = String(req.params.token || "")
  if (!token) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Brief not found")
  const [brief] = await service.listPartnerQuoteBriefs({ token_hash: hashQuoteToken(token) })
  if (!brief) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Brief not found")
  await assertQuoteVisibleToCaller(req, brief)

  const expired = brief.expires_at && new Date(brief.expires_at).getTime() <= Date.now()
  if (expired || !["open", "submitted"].includes(brief.status)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This brief can no longer be changed.")
  }

  const body = req.validatedBody as { question_key: string; name: string; type: string; content_base64: string }
  const [q] = await service.listPartnerQuoteBriefQuestions({ brief_id: brief.id, key: body.question_key })
  if (!q || q.kind !== "file") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "That question doesn't take files.")
  }
  const type = body.type.toLowerCase()
  if (!BRIEF_FILE_TYPES.includes(type)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Please upload an image (JPG, PNG, WebP, GIF, SVG) or a PDF.")
  }
  const size = Buffer.byteLength(body.content_base64, "base64")
  if (!size || size > BRIEF_FILE_MAX_BYTES) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Files can be up to 10 MB each.")
  }
  const current: any[] = Array.isArray(q.answer) ? q.answer : []
  if (current.length >= BRIEF_FILE_MAX_COUNT) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Up to ${BRIEF_FILE_MAX_COUNT} files per question.`)
  }

  // A safe name: no paths, no odd characters, keep the extension.
  const clean = body.name.split(/[\\/]/).pop()!.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-120) || "file"
  const { result } = await uploadFilesWorkflow(req.scope).run({
    input: {
      files: [
        {
          filename: `briefs/${brief.id}/${Date.now()}-${clean}`,
          mimeType: type,
          content: body.content_base64,
          access: "public",
        },
      ],
    },
  })
  const url = (result as any[])?.[0]?.url
  if (!url) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The upload did not return a file address.")

  await service.updatePartnerQuoteBriefQuestions({
    id: q.id,
    answer: [...current, { url, name: clean, type, size, uploaded_at: new Date().toISOString() }],
    answered_at: new Date(),
  })

  const country = typeof req.query.country === "string" ? req.query.country : null
  const view = await buildBriefView(req.scope, brief.id, { audience: "buyer", country })
  res.status(201).json({ brief: { ...view, link_state: "live", editable: true } })
}
