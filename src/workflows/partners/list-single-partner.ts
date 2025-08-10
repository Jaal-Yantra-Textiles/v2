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

    const fields = Array.from(new Set([...(input.fields || []), "*", "admins.*"]))

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
