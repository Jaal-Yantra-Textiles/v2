import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PAYMENT_REPORTS_MODULE } from "../../modules/payment_reports"
import Payment_reportsService from "../../modules/payment_reports/service"

export type DeletePaymentReportInput = { id: string }

export const deletePaymentReportStep = createStep(
  "delete-payment-report-step",
  async (input: DeletePaymentReportInput, { container }) => {
    const service: Payment_reportsService = container.resolve(PAYMENT_REPORTS_MODULE)
    await service.deletePayment_reports({ id: input.id })
    return new StepResponse(void 0)
  }
)

export const deletePayment_reportWorkflow = createWorkflow(
  "delete-payment-report",
  (input: DeletePaymentReportInput) => {
    deletePaymentReportStep(input)
    return new WorkflowResponse(void 0)
  }
)
