import { createStep, createWorkflow, StepResponse, WorkflowResponse, when } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments"
import InternalPaymentService from "../../modules/internal_payments/service"
import { PERSON_MODULE } from "../../modules/person"
import { PARTNER_MODULE } from "../../modules/partner"

export type CreatePaymentMethodInput = {
  type: "bank_account" | "cash_account" | "digital_wallet"
  account_name: string
  account_number?: string
  bank_name?: string
  ifsc_code?: string
  wallet_id?: string
  metadata?: Record<string, any> | null
  person_id?: string
  partner_id?: string
}

const createPaymentMethodStep = createStep(
  "create-payment-method-step",
  async (input: CreatePaymentMethodInput, { container }) => {
    const service: InternalPaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE)
    const created = await service.createPaymentDetailses({
      type: input.type,
      account_name: input.account_name,
      account_number: input.account_number,
      bank_name: input.bank_name,
      ifsc_code: input.ifsc_code,
      wallet_id: input.wallet_id,
      metadata: input.metadata ?? null,
    })
    return new StepResponse(created, created.id)
  },
  async (id: string, { container }) => {
    const service: InternalPaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE)
    await service.softDeletePaymentDetailses(id)
  }
)

const linkPaymentMethodStep = createStep(
  "link-payment-method-step",
  async (
    input: { payment_method_id: string; person_id?: string; partner_id?: string },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    const links: LinkDefinition[] = []

    if (input.person_id) {
      links.push({
        [PERSON_MODULE]: { person_id: input.person_id },
        [INTERNAL_PAYMENTS_MODULE]: { internal_payment_details_id: input.payment_method_id },
        data: { person_id: input.person_id, internal_payment_details_id: input.payment_method_id },
      })
    }
    if (input.partner_id) {
      links.push({
        [PARTNER_MODULE]: { partner_id: input.partner_id },
        [INTERNAL_PAYMENTS_MODULE]: { internal_payment_details_id: input.payment_method_id },
        data: { partner_id: input.partner_id, internal_payment_details_id: input.payment_method_id },
      })
    }

    if (links.length) {
      await remoteLink.create(links)
    }

    return new StepResponse(links, links)
  },
  async (links: LinkDefinition[], { container }) => {
    if (!links?.length) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss(links)
  }
)

export const createPaymentMethodAndLinkWorkflow = createWorkflow(
  {
    name: "create-payment-method-and-link",
    store: true
  },
  
  (input: CreatePaymentMethodInput) => {
    const method = createPaymentMethodStep(input)

    // Link to person if provided
    when(input, (i) => Boolean(i.person_id)).then(() => {
      linkPaymentMethodStep({
        payment_method_id: method.id,
        person_id: input.person_id,
      }).config({ name: 'link-to-person' })
    })

    // Link to partner if provided
    when(input, (i) => Boolean(i.partner_id)).then(() => {
      linkPaymentMethodStep({
        payment_method_id: method.id,
        partner_id: input.partner_id,
      }).config({ name: 'link-to-partner' })
    })

    return new WorkflowResponse(method)
  }
)
