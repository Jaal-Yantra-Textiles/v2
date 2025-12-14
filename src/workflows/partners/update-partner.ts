import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../modules/partner"
import PartnerService from "../../modules/partner/service"
import Scrypt from "scrypt-kdf"

export type UpdatePartnerInput = {
  id: string
  admin_id?: string
  admin_password?: string
  data: Partial<{
    name: string
    handle: string
    logo: string | null
    status: "active" | "inactive" | "pending"
    is_verified: boolean
    metadata: Record<string, any> | null
  }>
}

export const updatePartnerStep = createStep(
  "update-partner",
  async (input: UpdatePartnerInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

    // Fetch current partner for existence check and rollback snapshot
    const { data } = await query.graph({
      entity: "partners",
      fields: ["*"],
      filters: { id: input.id },
    })

    const existing = (data || [])[0]
    if (!existing) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner with id ${input.id} was not found`
      )
    }

    const updated = await partnerService.updatePartners({
      id: input.id,
      ...input.data,
    } as any)

    return new StepResponse(updated as any, existing)
  },
  // Rollback to previous state if available
  async (previous, { container }) => {
    if (!previous) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.updatePartners({
      id: previous.id,
      name: previous.name,
      handle: previous.handle,
      logo: previous.logo ?? null,
      status: previous.status,
      is_verified: previous.is_verified,
      metadata: previous.metadata ?? null,
    } as any)
  }
)

 export const updatePartnerAdminPasswordStep = createStep(
   "update-partner-admin-password",
   async (
     input: Pick<UpdatePartnerInput, "id" | "admin_id" | "admin_password">,
     { container }
   ) => {
     if (!input.admin_password) {
       return new StepResponse(null)
     }

     const query = container.resolve(ContainerRegistrationKeys.QUERY)
     const authModule = container.resolve(Modules.AUTH)

     const { data } = await query.graph({
       entity: "partners",
       fields: ["id", "admins.id", "admins.email", "admins.role"],
       filters: { id: input.id },
     })

     const partner = (data || [])[0]
     if (!partner) {
       throw new MedusaError(
         MedusaError.Types.NOT_FOUND,
         `Partner with id ${input.id} was not found`
       )
     }

     const admins = (partner.admins || []) as Array<{
       id: string
       email: string
       role?: "owner" | "admin" | "manager"
     }>

     const admin = (() => {
       if (input.admin_id) {
         return admins.find((a) => a.id === input.admin_id)
       }

       return admins.find((a) => a.role === "owner") || admins[0]
     })()

     if (!admin) {
       throw new MedusaError(
         MedusaError.Types.NOT_FOUND,
         `No admins found for partner with id ${input.id}`
       )
     }

     const providerIdentities = await authModule.listProviderIdentities({
       entity_id: admin.email,
     } as any)

     const providerIdentity = (providerIdentities || []).find(
       (pi: any) => pi.provider === "emailpass"
     )
     if (!providerIdentity) {
       throw new MedusaError(
         MedusaError.Types.NOT_FOUND,
         `No emailpass auth identity found for admin ${admin.email}`
       )
     }

     const previousProviderMetadata = providerIdentity.provider_metadata || {}

     const hashConfig = { logN: 15, r: 8, p: 1 }
     const hashed = await Scrypt.kdf(Buffer.from(input.admin_password), hashConfig)

     const updated = await authModule.updateProviderIdentities({
       id: providerIdentity.id,
       provider_metadata: {
         ...previousProviderMetadata,
         password: hashed.toString("base64"),
       },
     } as any)

     return new StepResponse(updated as any, {
       provider_identity_id: providerIdentity.id,
       previous_provider_metadata: previousProviderMetadata,
     })
   },
   async (rollbackData, { container }) => {
     if (!rollbackData?.provider_identity_id) return
     const authModule = container.resolve(Modules.AUTH)
     await authModule.updateProviderIdentities({
       id: rollbackData.provider_identity_id,
       provider_metadata: rollbackData.previous_provider_metadata,
     } as any)
   }
 )

export const updatePartnerWorkflow = createWorkflow(
  {
    name: "update-partner",
    store: true,
  },
  (input: UpdatePartnerInput) => {
    const result = updatePartnerStep(input)
     updatePartnerAdminPasswordStep({
       id: input.id,
       admin_id: input.admin_id,
       admin_password: input.admin_password,
     })
    return new WorkflowResponse(result)
  }
)

export default updatePartnerWorkflow
