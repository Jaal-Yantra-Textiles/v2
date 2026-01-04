import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import Partner from "../../modules/partner/models/partner"
import { InferTypeOf } from "@medusajs/framework/types"
export type Partners = InferTypeOf<typeof Partner>
type ListPartnersInput = {
  filters?: Record<string, any>
  fields?: string[]
  offset?: number
  limit?: number
}

export const listPartnersStep = createStep(
  "list-partners",
  async (input: ListPartnersInput, { container }) => {
    const query = container.resolve(
      ContainerRegistrationKeys.QUERY
    ) as Omit<RemoteQueryFunction, symbol>

    const rawFields = Array.isArray(input.fields)
      ? input.fields
      : typeof (input as any)?.fields === "string"
        ? ((input as any).fields as string).split(",")
        : []

    const cleanedFields = rawFields
      .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => !!s)

    const basicFields = [
      "id",
      "name",
      "handle",
      "logo",
      "status",
      "is_verified",
      "metadata",
      "created_at",
      "updated_at",
    ]

    const rootFields = cleanedFields.includes("*") ? ["*"] : ["id"]
    const fields = cleanedFields.length
      ? Array.from(
          new Set((rootFields.concat(cleanedFields) as string[]).filter(Boolean))
        )
      : basicFields

    const { data, metadata } = await query.graph({
      entity: "partner",
      fields,
      filters: input.filters || {},
      pagination: {
        skip: input.offset || 0,
        take: input.limit || 20,
      },
    })

    return new StepResponse({ data: (data || []) as Partners[], metadata })
  }
)

export const listPartnersWorkflow = createWorkflow(
  "list-partners",
  (input: ListPartnersInput) => {
    const result = listPartnersStep(input)
    return new WorkflowResponse(result)
  }
)
