import { 
    createStep,
    createWorkflow,
    StepResponse,
    WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { 
    setAuthAppMetadataStep,
} from "@medusajs/medusa/core-flows"
import { PARTNER_MODULE } from "../../modules/partner"
import PartnerService from "../../modules/partner/service"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { randomBytes } from "crypto"

export type CreatePartnerAdminWorkflowInput = {
    partner: {
        name: string
        handle?: string
        logo?: string
        status?: 'active' | 'inactive' | 'pending'
        is_verified?: boolean
    }
    admin: {
        email: string
        first_name?: string
        last_name?: string
        phone?: string
        role?: 'owner' | 'admin' | 'manager'
    }
    authIdentityId: string
    tempPassword?: string
}

import Scrypt from "scrypt-kdf"

const createPartnerAndAdminStep = createStep(
    "create-partner-and-admin-step",
    async ({ 
        partner: partnerData,
        admin: adminData,
    }: Omit<CreatePartnerAdminWorkflowInput, "authIdentityId">, 
    { container }) => {
        const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
        // Create partner
        let createdPartner: any
        try {
            createdPartner = await partnerService.createPartners(partnerData)
        } catch (err: any) {
            if (err.message?.includes?.("already exists")) {
                throw new MedusaError(
                    MedusaError.Types.DUPLICATE_ERROR,
                    `A partner with handle "${partnerData.handle}" already exists. Please use a unique handle.`
                )
            }
            throw err
        }
        
        // Create partner admin
        const partnerAdmin = await partnerService.createPartnerAdmins({
            ...adminData,
            partner_id: createdPartner.id
        })
        const partnerWithAdmin = {
            createdPartner, 
            partnerAdmin
        }
        return new StepResponse(partnerWithAdmin, {
            partner: partnerWithAdmin.createdPartner,
            partnerAdmin: partnerWithAdmin.partnerAdmin
        })
    },
    async (partnerWithAdmin, { container }) => {
        const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
        if (partnerWithAdmin) {
            await partnerService.deletePartnerAdmins(partnerWithAdmin.partnerAdmin.id)
            await partnerService.deletePartners(partnerWithAdmin.partner.id)
        }
    }
)

// External workflow: requires authIdentityId
const createPartnerAdminWorkflow = createWorkflow(
    "create-partner-admin",
    (input: CreatePartnerAdminWorkflowInput) => {
        const partnerWithAdmin = createPartnerAndAdminStep({
            partner: input.partner,
            admin: input.admin,
        })

        setAuthAppMetadataStep({
            authIdentityId: input.authIdentityId,
            actorType: "partner",
            value: partnerWithAdmin.partnerAdmin.id,  
        })

        return new WorkflowResponse(
            partnerWithAdmin
        )
    }
)

// Internal workflow: registers auth via provider and then sets app metadata
export type CreatePartnerAdminWithRegistrationInput = Omit<CreatePartnerAdminWorkflowInput, "authIdentityId">

const registerPartnerAdminAuthStep = createStep(
    "register-partner-admin-auth-step",
    async (input: { email: string }, { container }) => {
        const hashConfig = { logN: 15, r: 8, p: 1 }
        const rand = randomBytes(12)
        const tempPassword = await Scrypt.kdf(randomBytes(12), hashConfig )
        const authModule = container.resolve(Modules.AUTH)
        const reg = await authModule.createAuthIdentities({
            provider_identities: [{
              provider: "emailpass",
              entity_id: input.email,
              provider_metadata: {
                password: tempPassword.toString("base64")
              }
            }]
          });
        return new StepResponse({ authIdentityId: reg.id, tempPassword: rand.toString("base64") })
    }
)

export const createPartnerAdminWithRegistrationWorkflow = createWorkflow(
    "create-partner-admin-with-registration",
    (input: CreatePartnerAdminWithRegistrationInput) => {
        const partnerWithAdmin = createPartnerAndAdminStep({
            partner: input.partner,
            admin: input.admin,
        })

        const registered = registerPartnerAdminAuthStep({ email: input.admin.email })

        setAuthAppMetadataStep({
            authIdentityId: registered.authIdentityId,
            actorType: "partner",
            value: partnerWithAdmin.partnerAdmin.id,
        })

        return new WorkflowResponse({
            partnerWithAdmin,
            registered
        })
    }
)

export default createPartnerAdminWorkflow
