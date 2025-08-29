import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  WorkflowResponse,
  StepResponse,
  createWorkflow,
  transform
} from "@medusajs/framework/workflows-sdk"
import { DESIGN_MODULE } from "../../../modules/designs"
import { MedusaError } from "@medusajs/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerService from "../../../modules/partner/service"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"

type LinkDesignPartnerInput = {
  design_id: string
  partner_ids: string[]
}

const validatePartnersStep = createStep(
  "validate-partners-step",
  async (input: { partner_ids: string[] }, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

    const partners = await Promise.all(
      input.partner_ids.map(async (id) => {
        const partner = await partnerService.retrievePartner(id)
        if (!partner) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `Partner with id ${id} not found`
          )
        }
        return partner
      })
    )

    return new StepResponse(partners)
  }
)

const createDesignPartnerLinksStep = createStep(
  "create-design-partner-links-step",
  async (input: LinkDesignPartnerInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    const links: LinkDefinition[] = input.partner_ids.map(partnerId => ({
      [DESIGN_MODULE]: {
        design_id: input.design_id
      },
      [PARTNER_MODULE]: {
        partner_id: partnerId
      }
    }))

    await remoteLink.create(links)
    return new StepResponse(links)
  },
  async (links: LinkDefinition[] | undefined, { container }) => {
    if (!links) {
      return
    }
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss(links)
  }
)

export const linkDesignPartnerWorkflow = createWorkflow(
  "link-design-partner-workflow",
  (input: LinkDesignPartnerInput): WorkflowResponse<LinkDefinition[]> => {
    // Failure notification to admin feed
    const failureNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Partner Link",
            description: `Failed to link design ${data.input.design_id} to partner(s) ${data.input.partner_ids.join(", ")}. The link may have been rolled back.`,
          },
        },
      ]
    })
    notifyOnFailureStep(failureNotification)
    validatePartnersStep({ partner_ids: input.partner_ids })

    const links = createDesignPartnerLinksStep(input)

    // Success notification
    const successNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Partner Link",
            description: `Linked design ${data.input.design_id} to partner(s) ${data.input.partner_ids.join(", ")}.`,
          },
        },
      ]
    })
    sendNotificationsStep(successNotification)

    return new WorkflowResponse(links)
  }
)