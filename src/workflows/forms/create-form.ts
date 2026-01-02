import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { FORMS_MODULE } from "../../modules/forms"
import FormsService from "../../modules/forms/service"

export type CreateFormFieldInput = {
  name: string
  label: string
  type?:
    | "text"
    | "email"
    | "textarea"
    | "number"
    | "select"
    | "checkbox"
    | "radio"
    | "date"
    | "phone"
    | "url"
  required?: boolean
  placeholder?: string | null
  help_text?: string | null
  options?: Record<string, any> | null
  validation?: Record<string, any> | null
  order?: number
  metadata?: Record<string, any> | null
}

export type CreateFormStepInput = {
  website_id?: string | null
  domain?: string | null
  handle: string
  title: string
  description?: string | null
  status?: "draft" | "published" | "archived"
  submit_label?: string | null
  success_message?: string | null
  settings?: Record<string, any> | null
  metadata?: Record<string, any> | null
  fields?: CreateFormFieldInput[]
}

const createFormStep = createStep(
  "create-form",
  async (input: Omit<CreateFormStepInput, "fields">, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)
    const created = await forms.createForms({
      ...input,
      metadata: input.metadata || {},
    })

    return new StepResponse(created, created.id)
  },
  async (formId: string, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)
    await forms.softDeleteForms(formId)
  }
)

const createFormFieldsStep = createStep(
  "create-form-fields",
  async (
    input: { form_id: string; fields?: CreateFormFieldInput[] },
    { container }
  ) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)

    const fields = input.fields || []
    if (!fields.length) {
      return new StepResponse([] as any[], { form_id: input.form_id, field_ids: [] })
    }

    const created = await forms.createFormFields(
      fields.map((f, idx) => ({
        ...f,
        form_id: input.form_id,
        order: typeof f.order === "number" ? f.order : idx,
        metadata: f.metadata || {},
      }))
    )

    const createdList = Array.isArray(created) ? created : [created]
    const field_ids = createdList.map((f: any) => f.id)

    return new StepResponse(createdList, { form_id: input.form_id, field_ids })
  },
  async (rollbackData: { form_id: string; field_ids: string[] }, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)

    if (!rollbackData?.field_ids?.length) {
      return
    }

    await forms.softDeleteFormFields(rollbackData.field_ids)
  }
)

export const createFormWorkflow = createWorkflow(
  "create-form",
  (input: CreateFormStepInput) => {
    const { fields, ...formInput } = input

    const createdForm = createFormStep(formInput)

    const createdFormId = transform({ createdForm }, ({ createdForm }) => createdForm.id)

    createFormFieldsStep({
      form_id: createdFormId as unknown as string,
      fields,
    })

    return new WorkflowResponse(createdForm)
  }
)
