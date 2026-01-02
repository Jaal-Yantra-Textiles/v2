import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import { FORMS_MODULE } from "../../modules/forms"
import FormsService from "../../modules/forms/service"
import type { CreateFormFieldInput } from "./create-form"

export type SetFormFieldsInput = {
  id: string
  fields?: CreateFormFieldInput[]
}

type ExistingFieldSnapshot = {
  name: string
  label: string
  type: NonNullable<CreateFormFieldInput["type"]>
  required: boolean
  placeholder: string | null
  help_text: string | null
  options: Record<string, any> | null
  validation: Record<string, any> | null
  order: number
  metadata: Record<string, any> | null
}

const setFormFieldsStep = createStep(
  "set-form-fields",
  async (input: SetFormFieldsInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const forms: FormsService = container.resolve(FORMS_MODULE)

    const { data: formsData } = await query.graph({
      entity: "form",
      filters: { id: input.id },
      fields: ["id", "fields.*"],
      pagination: { take: 1 },
    })

    const form = (formsData || [])[0]
    const existing = (form?.fields || []) as any[]

    const existingIds = existing.map((f) => f.id).filter(Boolean)
    const existingSnapshot: ExistingFieldSnapshot[] = existing.map((f, idx) => ({
      name: f.name,
      label: f.label,
      type: (f.type || "text") as NonNullable<CreateFormFieldInput["type"]>,
      required: !!f.required,
      placeholder: f.placeholder ?? null,
      help_text: f.help_text ?? null,
      options: (f.options as any) ?? null,
      validation: (f.validation as any) ?? null,
      order: typeof f.order === "number" ? f.order : idx,
      metadata: (f.metadata as any) ?? null,
    }))

    if (existingIds.length) {
      await forms.softDeleteFormFields(existingIds)
    }

    const created = await forms.createFormFields(
      (input.fields || []).map((f, idx) => ({
        ...f,
        form_id: input.id,
        required: !!f.required,
        placeholder: f.placeholder ?? null,
        help_text: f.help_text ?? null,
        options: (f.options as any) ?? null,
        validation: (f.validation as any) ?? null,
        order: typeof f.order === "number" ? f.order : idx,
        metadata: (f.metadata as any) ?? {},
      }))
    )

    const createdList = Array.isArray(created) ? created : [created]
    const createdIds = createdList.map((f: any) => f.id).filter(Boolean)

    return new StepResponse(createdList, {
      form_id: input.id,
      created_ids: createdIds,
      existing: existingSnapshot,
    })
  },
  async (
    rollbackData: { form_id: string; created_ids: string[]; existing: ExistingFieldSnapshot[] },
    { container }
  ) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)

    if (rollbackData?.created_ids?.length) {
      await forms.softDeleteFormFields(rollbackData.created_ids)
    }

    if (rollbackData?.existing?.length) {
      await forms.createFormFields(
        rollbackData.existing.map((f, idx) => ({
          ...f,
          form_id: rollbackData.form_id,
          order: typeof f.order === "number" ? f.order : idx,
          type: (f.type || "text") as NonNullable<CreateFormFieldInput["type"]>,
          metadata: f.metadata || {},
        }))
      )
    }
  }
)

export const setFormFieldsWorkflow = createWorkflow(
  "set-form-fields",
  (input: SetFormFieldsInput) => {
    const result = setFormFieldsStep(input)
    return new WorkflowResponse(result)
  }
)
