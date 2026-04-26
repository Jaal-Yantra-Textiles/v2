import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { UpdatePayment_report } from "../validators"
import { listPayment_reportWorkflow } from "../../../../workflows/payment_reports/list-payment_report"
import { updatePayment_reportWorkflow } from "../../../../workflows/payment_reports/update-payment_report"
import { deletePayment_reportWorkflow } from "../../../../workflows/payment_reports/delete-payment_report"

// GET /admin/payment_reports/:id
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listPayment_reportWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  })
  const [reports] = result as [any[], number]
  if (!reports?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Payment report ${req.params.id} not found`)
  }
  res.status(200).json({ payment_report: reports[0] })
}

// PATCH /admin/payment_reports/:id
export const PATCH = async (req: MedusaRequest<UpdatePayment_report>, res: MedusaResponse) => {
  const { result } = await updatePayment_reportWorkflow(req.scope).run({
    input: { id: req.params.id, ...req.validatedBody },
  })
  res.status(200).json({ payment_report: result })
}

// DELETE /admin/payment_reports/:id
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deletePayment_reportWorkflow(req.scope).run({
    input: { id: req.params.id },
  })
  res.status(200).json({ id: req.params.id, object: "payment_report", deleted: true })
}
