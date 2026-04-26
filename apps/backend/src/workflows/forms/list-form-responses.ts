import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { FORMS_MODULE } from "../../modules/forms"
import FormsService from "../../modules/forms/service"

export type ListFormResponsesStepInput = {
  filters?: Record<string, any>
  config?: {
    skip?: number
    take?: number
    select?: string[]
    relations?: string[]
  }
}

const listFormResponsesStep = createStep(
  "list-form-responses",
  async (input: ListFormResponsesStepInput, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)
    const results = await forms.listAndCountFormResponses(input.filters, input.config)
    return new StepResponse(results)
  }
)

export const listFormResponsesWorkflow = createWorkflow(
  "list-form-responses",
  (input: ListFormResponsesStepInput) => {
    const results = listFormResponsesStep(input)
    return new WorkflowResponse(results)
  }
)
