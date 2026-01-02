import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { FORMS_MODULE } from "../../modules/forms"
import FormsService from "../../modules/forms/service"

export type DeleteFormStepInput = {
  id: string
}

const deleteFormStep = createStep(
  "delete-form",
  async (input: DeleteFormStepInput, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)
    const original = await forms.retrieveForm(input.id)

    await forms.softDeleteForms(input.id)

    return new StepResponse({ success: true }, original)
  }
)

export const deleteFormWorkflow = createWorkflow(
  "delete-form",
  (input: DeleteFormStepInput) => {
    const result = deleteFormStep(input)
    return new WorkflowResponse(result)
  }
)
