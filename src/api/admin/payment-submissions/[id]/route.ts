import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../modules/payment_submissions/service"

// GET /admin/payment-submissions/:id — get submission detail
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const submissions = await service.listPaymentSubmissions(
    { id: [id] },
    { relations: ["items"] }
  )

  const submission = submissions[0]
  if (!submission) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment submission not found: ${id}`
    )
  }

  return res.status(200).json({ payment_submission: submission })
}
