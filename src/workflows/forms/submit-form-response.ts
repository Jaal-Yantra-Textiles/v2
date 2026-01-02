import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { FORMS_MODULE } from "../../modules/forms"
import FormsService from "../../modules/forms/service"

export type SubmitFormResponseInput = {
  domain: string
  handle: string
  email?: string | null
  data: Record<string, any>
  page_url?: string | null
  referrer?: string | null
  ip?: string | null
  user_agent?: string | null
  metadata?: Record<string, any> | null
}

const fetchPublishedFormStep = createStep(
  "fetch-published-form",
  async (
    input: { domain: string; handle: string },
    { container }
  ): Promise<any> => {
    const query:any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: forms } = await query.graph({
      entity: "form",
      filters: {
        domain: input.domain,
        handle: input.handle,
        status: "published",
      },
      fields: ["*", "fields.*"],
      pagination: {
        take: 1,
      },
    })

    if (!forms?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Form '${input.handle}' not found for domain '${input.domain}'`
      )
    }

    return new StepResponse(forms[0])
  }
)

const validateResponseStep = createStep(
  "validate-form-response",
  async (input: { form: any; data: Record<string, any> }) => {
    const fields: any[] = input.form?.fields || []

    for (const f of fields) {
      if (!f?.name) {
        continue
      }

      if (f.required) {
        const val = input.data[f.name]
        if (val === undefined || val === null || val === "") {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Missing required field: ${f.name}`
          )
        }
      }

      if (f.type === "email") {
        const val = input.data[f.name]
        if (typeof val === "string" && val.length) {
          const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)
          if (!ok) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `Invalid email value for field: ${f.name}`
            )
          }
        }
      }
    }

    return new StepResponse(true)
  }
)

const createFormResponseStep = createStep(
  "create-form-response",
  async (input: { form_id: string } & Omit<SubmitFormResponseInput, "domain" | "handle"> & { submitted_at: Date }, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)

    const created = await forms.createFormResponses({
      form_id: input.form_id,
      status: "new",
      email: input.email || null,
      data: input.data,
      submitted_at: input.submitted_at,
      page_url: input.page_url || null,
      referrer: input.referrer || null,
      ip: input.ip || null,
      user_agent: input.user_agent || null,
      metadata: input.metadata || {},
    })

    return new StepResponse(created, created.id)
  },
  async (responseId: string, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)
    await forms.softDeleteFormResponses(responseId)
  }
)

export const submitFormResponseWorkflow = createWorkflow(
  "submit-form-response",
  (input: SubmitFormResponseInput) => {
    const form = fetchPublishedFormStep({
      domain: input.domain,
      handle: input.handle,
    })

    validateResponseStep({
      form,
      data: input.data,
    })

    const submittedAt = transform({}, () => new Date()) as unknown as Date

    const created = createFormResponseStep({
      form_id: (form as any).id,
      email: input.email,
      data: input.data,
      page_url: input.page_url,
      referrer: input.referrer,
      ip: input.ip,
      user_agent: input.user_agent,
      metadata: input.metadata,
      submitted_at: submittedAt,
    })

    return new WorkflowResponse(created)
  }
)
