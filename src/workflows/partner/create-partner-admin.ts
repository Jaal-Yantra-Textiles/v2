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
import { MedusaError } from "@medusajs/framework/utils"

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
}

const createPartnerAndAdminStep = createStep(
    "create-partner-and-admin-step",
    async ({ 
        partner: partnerData,
        admin: adminData,
    }: Omit<CreatePartnerAdminWorkflowInput, "authIdentityId">, 
    { container }) => {
        const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
        let createdPartner: any
        // Create partner
        const partner = await partnerService.createPartners(partnerData).catch(err => {
            if(err.message.includes("already exists")){
                throw new MedusaError(
                    MedusaError.Types.DUPLICATE_ERROR,
                    `A partner with handle "${partnerData.handle}" already exists. Please use a unique handle.`
                )
            }
        }).then((partner) => {
            partner = createdPartner
        })
        
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
        if(partnerWithAdmin){
            await partnerService.deletePartnerAdmins(partnerWithAdmin.partnerAdmin.id)
            await partnerService.deletePartners(partnerWithAdmin?.partner.id)
        }

        
    }
)

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

export default createPartnerAdminWorkflow
