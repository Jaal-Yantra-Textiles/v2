import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
} from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments"
import { PERSON_MODULE } from "../../modules/person"
import { PARTNER_MODULE } from "../../modules/partner"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import InternalPaymentService from "../../modules/internal_payments/service"

export type CreatePaymentAndLinkInput = {
  payment: {
    amount: number
    status?: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled"
    payment_type: "Bank" | "Cash" | "Digital_Wallet"
    payment_date: Date
    metadata?: Record<string, any> | null
    paid_to_id?: string
  }
  personIds?: string[]
  partnerIds?: string[]
  inventoryOrderIds?: string[]
}

export const createPaymentStep = createStep(
  "create-payment-for-link-step",
  async (input: CreatePaymentAndLinkInput["payment"], { container }) => {
    const service: InternalPaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE)
    const created = await service.createPayments(input)
    return new StepResponse(created, created.id)
  },
  async (id: string, { container }) => {
    const service: InternalPaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE)
    await service.softDeletePayments(id)
  }
)

export const linkPaymentToPersonsStep = createStep(
  "link-payment-to-persons-step",
  async (
    input: { payment_id: string; person_ids: string[] },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const links: LinkDefinition[] = input.person_ids.map((person_id) => ({
      [PERSON_MODULE]: {
        person_id,
      },
      [INTERNAL_PAYMENTS_MODULE]: {
        internal_payments_id: input.payment_id,
      },
      data: {
        person_id,
        payment_id: input.payment_id,
        linked_with: "person",
      },
    }))

    if (links.length) {
      await remoteLink.create(links)
    }

    return new StepResponse(links, links)
  },
  async (rollbackLinks: LinkDefinition[], { container }) => {
    if (!rollbackLinks?.length) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss(rollbackLinks)
  }
)

export const linkPaymentToPartnersStep = createStep(
  "link-payment-to-partners-step",
  async (
    input: { payment_id: string; partner_ids: string[] },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const links: LinkDefinition[] = input.partner_ids.map((partner_id) => ({
      [PARTNER_MODULE]: {
        partner_id,
      },
      [INTERNAL_PAYMENTS_MODULE]: {
        internal_payments_id: input.payment_id,
      },
      data: {
        partner_id,
        payment_id: input.payment_id,
        linked_with: "partner",
      },
    }))

    if (links.length) {
      await remoteLink.create(links)
    }

    return new StepResponse(links, links)
  },
  async (rollbackLinks: LinkDefinition[], { container }) => {
    if (!rollbackLinks?.length) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss(rollbackLinks)
  }
)

export const linkPaymentToInventoryOrdersStep = createStep(
  "link-payment-to-inventory-orders-step",
  async (
    input: { payment_id: string; inventory_order_ids: string[] },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const links: LinkDefinition[] = input.inventory_order_ids.map((inventory_orders_id) => ({
      [ORDER_INVENTORY_MODULE]: {
        inventory_orders_id,
      },
      [INTERNAL_PAYMENTS_MODULE]: {
        internal_payments_id: input.payment_id,
      },
      data: {
        inventory_orders_id,
        payment_id: input.payment_id,
        linked_with: "inventory_order",
      },
    }))

    if (links.length) {
      await remoteLink.create(links)
    }

    return new StepResponse(links, links)
  },
  async (rollbackLinks: LinkDefinition[], { container }) => {
    if (!rollbackLinks?.length) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss(rollbackLinks)
  }
)

export const createPaymentAndLinkWorkflow = createWorkflow(
  "create-payment-and-link",
  (input: CreatePaymentAndLinkInput) => {
    const payment = createPaymentStep(input.payment)

    const personLinks = when(input, (i) => Boolean(i.personIds && i.personIds.length)).then(() =>
      linkPaymentToPersonsStep({
        payment_id: payment.id,
        person_ids: input.personIds as string[],
      })
    )

    const partnerLinks = when(input, (i) => Boolean(i.partnerIds && i.partnerIds.length)).then(() =>
      linkPaymentToPartnersStep({
        payment_id: payment.id,
        partner_ids: input.partnerIds as string[],
      })
    )

    const inventoryOrderLinks = when(input, (i) => Boolean(i.inventoryOrderIds && i.inventoryOrderIds.length)).then(() =>
      linkPaymentToInventoryOrdersStep({
        payment_id: payment.id,
        inventory_order_ids: input.inventoryOrderIds as string[],
      })
    )

    return new WorkflowResponse({ payment, personLinks, partnerLinks, inventoryOrderLinks })
  }
)
