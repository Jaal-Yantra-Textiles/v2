import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../modules/payment_submissions/service"
import { createPaymentSubmissionWorkflow } from "../../../workflows/payment_submissions/create-payment-submission"

// GET /admin/payment-submissions — list all submissions with filters
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { offset = 0, limit = 20, status, partner_id } = (req.validatedQuery ||
    req.query) as any

  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const filters: any = {}
  if (status) filters.status = status
  if (partner_id) filters.partner_id = partner_id

  const [submissions, count] = await service.listAndCountPaymentSubmissions(
    filters,
    {
      skip: Number(offset),
      take: Number(limit),
      order: { created_at: "DESC" },
      relations: ["items"],
    }
  )

  return res.status(200).json({
    payment_submissions: submissions,
    count,
    offset: Number(offset),
    limit: Number(limit),
  })
}

// POST /admin/payment-submissions — create a submission on behalf of a partner
// Reuses the shared createPaymentSubmissionWorkflow which validates ownership
// and eligibility regardless of whether a partner or an admin is calling it.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req as any).validatedBody as {
    partner_id: string
    design_ids?: string[]
    task_ids?: string[]
    notes?: string
    documents?: Array<{ id?: string; url: string; filename?: string; mimeType?: string }>
    metadata?: Record<string, any>
  }

  const { result } = await createPaymentSubmissionWorkflow(req.scope).run({
    input: {
      partner_id: body.partner_id,
      design_ids: body.design_ids || [],
      task_ids: body.task_ids || [],
      notes: body.notes,
      documents: body.documents,
      metadata: {
        ...(body.metadata || {}),
        // Mark the origin so reviewers can tell admin-created submissions apart
        created_by: "admin",
      },
    },
  })

  return res.status(201).json({ payment_submission: result.submission })
}
