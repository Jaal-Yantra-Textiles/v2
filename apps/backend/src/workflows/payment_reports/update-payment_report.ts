import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PAYMENT_REPORTS_MODULE } from "../../modules/payment_reports"
import Payment_reportsService from "../../modules/payment_reports/service"

export type UpdatePaymentReportInput = {
  id: string
  name?: string
  metadata?: Record<string, any>
}

export const updatePaymentReportStep = createStep(
  "update-payment-report-step",
  async (input: UpdatePaymentReportInput, { container }) => {
    const service: Payment_reportsService = container.resolve(PAYMENT_REPORTS_MODULE)
    const { id, ...data } = input
    const [existing] = await service.listPayment_reports({ id: [id] })
    const report = await service.updatePayment_reports({ id, ...data })
    return new StepResponse(report, { id, prev: existing })
  },
  async (compensationInput, { container }) => {
    if (!compensationInput) return
    const { id, prev } = compensationInput
    if (!prev) return
    const service: Payment_reportsService = container.resolve(PAYMENT_REPORTS_MODULE)
    await service.updatePayment_reports({ id, name: prev.name, metadata: prev.metadata as any })
  }
)

export const updatePayment_reportWorkflow = createWorkflow(
  "update-payment-report",
  (input: UpdatePaymentReportInput) => {
    const report = updatePaymentReportStep(input)
    return new WorkflowResponse(report)
  }
)
