import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import {
  Payment_report,
  ListPaymentReportsQuery,
} from "./validators"
import { createPayment_reportWorkflow } from "../../../workflows/payment_reports/create-payment_reports"
import { listPayment_reportWorkflow } from "../../../workflows/payment_reports/list-payment_reports"

// GET /admin/payment_reports — list saved report snapshots
export const GET = async (req: MedusaRequest<ListPaymentReportsQuery>, res: MedusaResponse) => {
  const { entity_type, entity_id, limit = 20, offset = 0 } =
    (req.validatedQuery ?? {}) as Partial<ListPaymentReportsQuery>

  const filters: Record<string, any> = {}
  if (entity_type) filters.entity_type = entity_type
  if (entity_id) filters.entity_id = entity_id

  const { result } = await listPayment_reportWorkflow(req.scope).run({
    input: { filters, config: { skip: offset, take: limit } },
  })

  const [reports, count] = result as [any[], number]
  res.status(200).json({ payment_reports: reports, count, offset, limit })
}

// POST /admin/payment_reports — generate + persist a snapshot
export const POST = async (req: MedusaRequest<Payment_report>, res: MedusaResponse) => {
  const { result } = await createPayment_reportWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  res.status(201).json({ payment_report: result })
}
