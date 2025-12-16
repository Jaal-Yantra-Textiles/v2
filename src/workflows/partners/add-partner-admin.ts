import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import { PARTNER_MODULE } from "../../modules/partner"
import PartnerService from "../../modules/partner/service"

export type AddPartnerAdminInput = {
  partner_id: string
  admin: {
    email: string
    first_name?: string
    last_name?: string
    phone?: string
    role?: "owner" | "admin" | "manager"
    metadata?: Record<string, any>
  }
}

export const addPartnerAdminStep = createStep(
  "add-partner-admin",
  async (input: AddPartnerAdminInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

    // Ensure partner exists
    const { data } = await query.graph({
      entity: "partners",
      fields: ["id", "handle", "name"],
      filters: { id: input.partner_id },
    })
    const partner = (data || [])[0]
    if (!partner) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner with id ${input.partner_id} was not found`
      )
    }

    // Create admin
    const created = await partnerService.createPartnerAdmins({
      ...input.admin,
      partner_id: input.partner_id,
    } as any)

    return new StepResponse(created as any, created.id)
  },
  // Rollback: delete the created admin if step compensates
  async (adminId, { container }) => {
    if (!adminId) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.deletePartnerAdmins(adminId)
  }
)

export const addPartnerAdminWorkflow = createWorkflow(
  {
    name: "add-partner-admin",
    store: true,
  },
  (input: AddPartnerAdminInput) => {
    const result = addPartnerAdminStep(input)
    return new WorkflowResponse(result)
  }
)

export default addPartnerAdminWorkflow
