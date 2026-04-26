import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { FORMS_MODULE } from "../../modules/forms"
import FormsService from "../../modules/forms/service"

export type UpdateFormStepInput = {
  id: string
  website_id?: string | null
  domain?: string | null
  handle?: string
  title?: string
  description?: string | null
  status?: "draft" | "published" | "archived"
  submit_label?: string | null
  success_message?: string | null
  settings?: Record<string, any> | null
  metadata?: Record<string, any> | null
}

const updateFormStep = createStep(
  "update-form",
  async (input: UpdateFormStepInput, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)
    const { id, ...data } = input

    const original = await forms.retrieveForm(id)
    const updated = await forms.updateForms({
      id,
      ...data,
    })

    return new StepResponse(updated, { id, original })
  },
  async (rollbackData: { id: string; original: any }, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)
    await forms.updateForms({ id: rollbackData.id, ...(rollbackData.original as any) })
  }
)

export const updateFormWorkflow = createWorkflow(
  "update-form",
  (input: UpdateFormStepInput) => {
    const result = updateFormStep(input)
    return new WorkflowResponse(result)
  }
)
