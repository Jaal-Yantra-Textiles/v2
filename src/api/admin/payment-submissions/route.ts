import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../modules/payment_submissions/service"

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
