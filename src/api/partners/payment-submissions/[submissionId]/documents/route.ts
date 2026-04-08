import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../../../helpers"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../../modules/payment_submissions/service"

// POST /partners/payment-submissions/:submissionId/documents
// Upload bill/invoice documents for a payment submission
export const POST = async (
  req: AuthenticatedMedusaRequest & {
    files?: Express.Multer.File[]
    file?: Express.Multer.File
  },
  res: MedusaResponse
) => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const { submissionId } = req.params
  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  // Verify submission exists and belongs to this partner
  const submissions = await service.listPaymentSubmissions({
    id: [submissionId],
  })
  const submission = submissions[0]

  if (!submission) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment submission not found: ${submissionId}`
    )
  }

  if (submission.partner_id !== partner.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "You do not have access to this submission"
    )
  }

  // Normalize uploaded files
  const uploadedFiles: Express.Multer.File[] = Array.isArray(req.files)
    ? (req.files as Express.Multer.File[])
    : req.file
      ? [req.file as Express.Multer.File]
      : []

  if (!uploadedFiles.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No files provided for upload"
    )
  }

  // Upload files using core flow
  const results: Array<{
    id?: string
    url: string
    filename: string
    mimeType: string
  }> = []

  for (const f of uploadedFiles) {
    const payload = {
      filename: f.originalname,
      mimeType: f.mimetype,
      content: f.buffer?.toString("base64"),
      access: "public" as const,
    }

    if (!payload.content) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Missing file content for ${f.originalname}`
      )
    }

    const out = await uploadFilesWorkflow.run({
      input: { files: [payload] },
    })
    const resu = out.result
    const arr = Array.isArray(resu)
      ? resu
      : resu && (resu as any).files && Array.isArray((resu as any).files)
        ? (resu as any).files
        : resu &&
            (resu as any).uploaded &&
            Array.isArray((resu as any).uploaded)
          ? (resu as any).uploaded
          : []

    if (arr.length) {
      const file = arr[0] as any
      results.push({
        id: file.id,
        url: file.url || file.location || file.key,
        filename: f.originalname,
        mimeType: f.mimetype,
      })
    }
  }

  // Append to existing documents on the submission
  const existingDocs = (submission as any).documents || []
  const allDocs = [...existingDocs, ...results]

  await service.updatePaymentSubmissions({
    id: submissionId,
    documents: allDocs,
  })

  return res.status(200).json({ files: results, documents: allDocs })
}
