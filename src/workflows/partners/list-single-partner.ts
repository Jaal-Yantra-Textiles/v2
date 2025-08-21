import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export type ListSinglePartnerInput = {
  id: string
  fields?: string[]
}

export const listSinglePartnerStep = createStep(
  "list-single-partner",
  async (input: ListSinglePartnerInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    // Normalize fields: accept array or comma-joined strings, trim, filter empties, dedupe
    const raw = Array.isArray(input.fields)
      ? input.fields
      : typeof (input as any)?.fields === "string"
        ? (input as any).fields.split(",")
        : []
    const cleaned = raw
      .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => !!s)
    const fields = Array.from(new Set(["*", "admins.*", ...cleaned]))
    const { data } = await query.graph({
      entity: "partners",
      fields,
      filters: { id: input.id },
    })

    const partner = (data || [])[0]

    if (!partner) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner with id ${input.id} was not found`
      )
    }

    return new StepResponse(partner as any, partner.id)
  }
)

export const listSinglePartnerWorkflow = createWorkflow(
  {
    name: "list-single-partner",
    store: true,
  },
  (input: ListSinglePartnerInput) => {
    const result = listSinglePartnerStep(input)
    return new WorkflowResponse(result)
  }
)

export default listSinglePartnerWorkflow
