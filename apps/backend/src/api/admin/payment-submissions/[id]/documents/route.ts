/**
 * @route /admin/payment-submissions/:id/documents
 * @scope admin
 *
 * Attach and remove supporting documents on a payout — bills, invoices,
 * transfer receipts.
 *
 * 🔑 Deliberately NOT gated on status. `documents` could only ever be set at
 * creation time, and the proof a payout actually happened — the bank receipt —
 * only exists AFTER the money moves, by which point the submission is Approved
 * or Paid and every other write is refused. A rule that locks the record at the
 * moment evidence starts arriving guarantees the evidence lives somewhere else.
 *
 * This is an append/remove of attachments, not a re-opening of the payout: it
 * cannot touch amounts, lines, status or claims. Nothing here changes what is
 * owed, so the reasons the other routes refuse a settled submission do not
 * apply.
 *
 * ⚠️ `documents` is a JSON column, so every write here re-reads and rewrites
 * the whole array. That is exactly the footgun #1615's `metadata` notes warn
 * about — a wholesale write erasing a sibling key — which is why POST appends
 * to what it just read rather than accepting a full array from the caller.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../../modules/payment_submissions/service"
import { AdminAttachSubmissionDocumentsReq } from "./validators"

type SubmissionDocument = {
  id: string
  url: string
  filename?: string
  mimeType?: string
  size?: number
  uploaded_at?: string
}

const readDocuments = (submission: any): SubmissionDocument[] => {
  const raw = submission?.documents
  return Array.isArray(raw) ? (raw as SubmissionDocument[]) : []
}

const retrieve = async (req: MedusaRequest) => {
  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const [submission] = await service.listPaymentSubmissions({
    id: [req.params.id],
  })

  if (!submission) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment submission not found: ${req.params.id}`
    )
  }

  return { service, submission }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { submission } = await retrieve(req)

  res.status(200).json({ documents: readDocuments(submission) })
}

export const POST = async (
  req: MedusaRequest<AdminAttachSubmissionDocumentsReq>,
  res: MedusaResponse
) => {
  const { service, submission } = await retrieve(req)

  const existing = readDocuments(submission)
  const seen = new Set(existing.map((d) => d.id).filter(Boolean))

  const now = new Date().toISOString()
  const added: SubmissionDocument[] = []

  for (const doc of req.validatedBody.documents) {
    // An id repeated across two uploads is the same file attached twice, which
    // is noise rather than an error — skip it and report what actually landed.
    if (doc.id && seen.has(doc.id)) continue
    if (doc.id) seen.add(doc.id)

    added.push({
      id: doc.id || `doc_${now}_${added.length}`,
      url: doc.url,
      filename: doc.filename,
      mimeType: doc.mimeType,
      size: doc.size,
      uploaded_at: now,
    })
  }

  if (!added.length) {
    return res
      .status(200)
      .json({ documents: existing, added: 0, message: "Nothing new to attach" })
  }

  const documents = [...existing, ...added]

  await service.updatePaymentSubmissions({
    id: req.params.id,
    documents: documents as any,
  })

  res.status(201).json({ documents, added: added.length })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { service, submission } = await retrieve(req)

  const documentId = String((req.query as any)?.document_id || "")
  if (!documentId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "document_id is required — refusing to clear every attachment on this payout"
    )
  }

  const existing = readDocuments(submission)
  const documents = existing.filter((d) => d.id !== documentId)

  if (documents.length === existing.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No document ${documentId} on submission ${req.params.id}`
    )
  }

  await service.updatePaymentSubmissions({
    id: req.params.id,
    documents: documents as any,
  })

  res.status(200).json({ documents })
}
