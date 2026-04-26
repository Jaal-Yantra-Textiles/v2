import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PARTNER_MODULE } from "../../modules/partner"
import PartnerService from "../../modules/partner/service"

type DeletePartnerInput = {
  id: string
}

const deletePartnerAdminsStep = createStep(
  "delete-partner-admins-step",
  async (input: DeletePartnerInput, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    const admins = await partnerService.listPartnerAdmins({
      partner_id: input.id,
    })
    if (admins.length) {
      await partnerService.softDeletePartnerAdmins(admins.map((a: any) => a.id))
    }
    return new StepResponse({ count: admins.length }, { adminIds: admins.map((a: any) => a.id) })
  },
  async (data: { adminIds: string[] } | undefined, { container }) => {
    if (!data?.adminIds?.length) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.restorePartnerAdmins(data.adminIds)
  }
)

const softDeletePartnerStep = createStep(
  "soft-delete-partner-step",
  async (input: DeletePartnerInput, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.softDeletePartners(input.id)
    return new StepResponse({ id: input.id }, { id: input.id })
  },
  async (data: { id: string } | undefined, { container }) => {
    if (!data?.id) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.restorePartners(data.id)
  }
)

export const deletePartnerWorkflow = createWorkflow(
  "delete-partner",
  (input: DeletePartnerInput) => {
    deletePartnerAdminsStep(input)
    const result = softDeletePartnerStep(input)
    return new WorkflowResponse(result)
  }
)

export default deletePartnerWorkflow
