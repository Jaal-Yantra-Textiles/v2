import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PAYMENT_REPORTS_MODULE } from "../../modules/payment_reports"
import Payment_reportsService from "../../modules/payment_reports/service"

export type ListPaymentReportsInput = {
  filters?: Record<string, any>
  config?: {
    skip?: number
    take?: number
    select?: string[]
    relations?: string[]
  }
}

export const listPaymentReportsStep = createStep(
  "list-payment-reports-step",
  async (input: ListPaymentReportsInput, { container }) => {
    const service: Payment_reportsService = container.resolve(PAYMENT_REPORTS_MODULE)
    const results = await service.listAndCountPayment_reports(input.filters, input.config)
    return new StepResponse(results)
  }
)

export const listPayment_reportWorkflow = createWorkflow(
  "list-payment-reports",
  (input: ListPaymentReportsInput) => {
    const results = listPaymentReportsStep(input)
    return new WorkflowResponse(results)
  }
)
