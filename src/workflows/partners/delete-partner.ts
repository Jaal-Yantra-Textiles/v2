import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PARTNER_MODULE } from "../../modules/partner"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PartnerService from "../../modules/partner/service"

type DeletePartnerInput = {
  id: string
}

const dismissPartnerLinksStep = createStep(
  "dismiss-partner-links-step",
  async (input: DeletePartnerInput, { container }) => {
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss({
      [PARTNER_MODULE]: { partner_id: input.id },
    })
    return new StepResponse(undefined)
  }
)

const deletePartnerAdminsStep = createStep(
  "delete-partner-admins-step",
  async (input: DeletePartnerInput, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    const admins = await partnerService.listPartnerAdmins({
      partner_id: input.id,
    })
    if (admins.length) {
      await partnerService.deletePartnerAdmins(admins.map((a: any) => a.id))
    }
    return new StepResponse({ admins }, { admins })
  },
  async (data: { admins: any[] } | undefined, { container }) => {
    if (!data?.admins?.length) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    for (const admin of data.admins) {
      await partnerService.createPartnerAdmins(admin)
    }
  }
)

const deletePartnerStep = createStep(
  "delete-partner-step",
  async (input: DeletePartnerInput, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    const partner = await partnerService.retrievePartner(input.id)
    await partnerService.deletePartners(input.id)
    return new StepResponse({ id: input.id }, { originalData: partner })
  },
  async (data: { originalData: any } | undefined, { container }) => {
    if (!data?.originalData) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.createPartners(data.originalData)
  }
)

export const deletePartnerWorkflow = createWorkflow(
  "delete-partner",
  (input: DeletePartnerInput) => {
    dismissPartnerLinksStep(input)
    deletePartnerAdminsStep(input)
    const result = deletePartnerStep(input)
    return new WorkflowResponse(result)
  }
)

export default deletePartnerWorkflow
