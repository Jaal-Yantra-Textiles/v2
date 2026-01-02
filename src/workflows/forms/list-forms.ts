import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { FORMS_MODULE } from "../../modules/forms"
import FormsService from "../../modules/forms/service"

export type ListFormsStepInput = {
  filters?: Record<string, any>
  config?: {
    skip?: number
    take?: number
    select?: string[]
    relations?: string[]
  }
}

const listFormsStep = createStep(
  "list-forms",
  async (input: ListFormsStepInput, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)
    const results = await forms.listAndCountForms(input.filters, input.config)
    return new StepResponse(results)
  }
)

export const listFormsWorkflow = createWorkflow(
  "list-forms",
  (input: ListFormsStepInput) => {
    const results = listFormsStep(input)
    return new WorkflowResponse(results)
  }
)
