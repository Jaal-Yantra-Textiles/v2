import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { setAuthAppMetadataStep } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { IAuthModuleService, RemoteQueryFunction } from "@medusajs/types"
import { PARTNER_MODULE } from "../../modules/partner"
import PartnerService from "../../modules/partner/service"
import { randomBytes } from "crypto"
import Scrypt from "scrypt-kdf"

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
  password?: string
}

// Step 1: Create the admin record
const addPartnerAdminStep = createStep(
  "add-partner-admin",
  async (input: AddPartnerAdminInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

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

    const created = await partnerService.createPartnerAdmins({
      ...input.admin,
      partner_id: input.partner_id,
    } as any)

    return new StepResponse({ admin: created, partner } as any, created.id)
  },
  async (adminId, { container }) => {
    if (!adminId) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.deletePartnerAdmins(adminId)
  }
)

// Step 2: Register auth credentials
const registerAdminAuthStep = createStep(
  "register-new-admin-auth-step",
  async (input: { email: string; password?: string }, { container }) => {
    const hashConfig = { logN: 15, r: 8, p: 1 }
    const plainPassword = input.password || randomBytes(12).toString("base64")
    const hashed = await Scrypt.kdf(Buffer.from(plainPassword), hashConfig)

    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService

    const reg = await authModule.createAuthIdentities({
      provider_identities: [
        {
          provider: "emailpass",
          entity_id: input.email,
          provider_metadata: {
            password: hashed.toString("base64"),
          },
        },
      ],
    })

    return new StepResponse({ authIdentityId: reg.id, tempPassword: plainPassword })
  }
)

// Step 3: Emit event for email subscriber
const emitAdminAddedEventStep = createStep(
  "emit-admin-added-event",
  async (
    input: {
      partner_id: string
      partner_name: string
      admin_email: string
      admin_name: string
      temp_password: string
    },
    { container }
  ) => {
    const eventBus = container.resolve(Modules.EVENT_BUS) as any
    await eventBus.emit({
      name: "partner.admin.added",
      data: input,
    })
    return new StepResponse({ emitted: true })
  }
)

export const addPartnerAdminWorkflow = createWorkflow(
  { name: "add-partner-admin", store: true },
  (input: AddPartnerAdminInput) => {
    const result = addPartnerAdminStep(input)

    const registered = registerAdminAuthStep({
      email: input.admin.email,
      password: input.password,
    })

    setAuthAppMetadataStep({
      authIdentityId: registered.authIdentityId,
      actorType: "partner",
      value: result.partner.id,
    })

    const emitData = transform(
      { result, input, registered },
      (data) => ({
        partner_id: data.result.partner.id,
        partner_name: data.result.partner.name,
        admin_email: data.input.admin.email,
        admin_name: [data.input.admin.first_name, data.input.admin.last_name]
          .filter(Boolean)
          .join(" ") || data.input.admin.email,
        temp_password: data.registered.tempPassword,
      })
    )

    emitAdminAddedEventStep(emitData)

    return new WorkflowResponse({
      admin: result.admin,
      tempPassword: registered.tempPassword,
    })
  }
)

export default addPartnerAdminWorkflow
