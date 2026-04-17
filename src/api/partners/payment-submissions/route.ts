import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { createPaymentSubmissionWorkflow } from "../../../workflows/payment_submissions/create-payment-submission"
import submissionPartnerLink from "../../../links/submission-partner-link"

// GET /partners/payment-submissions — list partner's own submissions
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }

  const { offset = 0, limit = 20, status } = (req.validatedQuery || {}) as any
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const filters: any = { partner_id: partner.id }

  const { data } = await query.graph({
    entity: submissionPartnerLink.entryPoint,
    fields: ["payment_submission.*", "payment_submission.items.*"],
    filters,
  })

  let submissions = (data || [])
    .map((r: any) => r.payment_submission)
    .filter(Boolean)

  if (status) {
    submissions = submissions.filter((s: any) => s.status === status)
  }

  // Sort newest first
  submissions.sort(
    (a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  const count = submissions.length
  const paginated = submissions.slice(offset, offset + limit)

  return res.status(200).json({
    payment_submissions: paginated,
    count,
    offset,
    limit,
  })
}

// POST /partners/payment-submissions — create a new submission
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }

  const body = req.validatedBody as any

  const { result } = await createPaymentSubmissionWorkflow(req.scope).run({
    input: {
      partner_id: partner.id,
      design_ids: body.design_ids || [],
      task_ids: body.task_ids || [],
      notes: body.notes,
      documents: body.documents,
      metadata: body.metadata,
    },
  })

  return res.status(201).json({ payment_submission: result.submission })
}
