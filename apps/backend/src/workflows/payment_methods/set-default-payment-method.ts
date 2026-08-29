import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments"
import InternalPaymentService from "../../modules/internal_payments/service"
import PartnerPaymentMethodsLink from "../../links/partner-payment-methods-link"
import PersonPaymentMethodsLink from "../../links/person-payment-methods-link"

export type SetDefaultPaymentMethodInput = {
  payment_method_id: string
  partner_id?: string
  person_id?: string
}

/**
 * Make one payment method the owner's default, and no other.
 *
 * "Default" is exclusive per OWNER, not global: `internal_payment_details` rows
 * are reachable from a partner and from a person through two separate link
 * tables, so the sibling set has to be resolved through whichever one applies.
 *
 * 🔴 Why an owner scope is mandatory rather than "unset every other row".
 * Sharlho (`01K4PJMNMNRGMK0ZXMKBBDZDGD`) has FOUR bank accounts in production,
 * one per employee — Shashi kumar, Shashi Kumar, Archana Thakur, Tenzin Norbu —
 * and three of them have been paid at different times. A global unset would
 * silently clear another partner's default while setting this one.
 */
export const setDefaultPaymentMethodStep = createStep(
  "set-default-payment-method-step",
  async (input: SetDefaultPaymentMethodInput, { container }) => {
    const service: InternalPaymentService = container.resolve(
      INTERNAL_PAYMENTS_MODULE
    )
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    // Resolve the owner's full set of methods, so "default" can be exclusive.
    let siblingIds: string[] = []

    if (input.partner_id) {
      const { data } = await query.graph({
        entity: PartnerPaymentMethodsLink.entryPoint,
        fields: ["internal_payment_details_id"],
        filters: { partner_id: input.partner_id },
      })
      siblingIds = (data || []).map((r: any) => r.internal_payment_details_id)
    } else if (input.person_id) {
      const { data } = await query.graph({
        entity: PersonPaymentMethodsLink.entryPoint,
        fields: ["internal_payment_details_id"],
        filters: { person_id: input.person_id },
      })
      siblingIds = (data || []).map((r: any) => r.internal_payment_details_id)
    } else {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot set a default payment method without a partner_id or person_id to scope it to."
      )
    }

    if (!siblingIds.includes(input.payment_method_id)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Payment method ${input.payment_method_id} is not linked to this ${
          input.partner_id ? "partner" : "person"
        }, so it cannot be made their default.`
      )
    }

    // Capture prior state before touching anything, for compensation.
    const before = await service.listPaymentDetails({ id: siblingIds })
    const previousDefaults = (before as any[])
      .filter((m) => m.is_default)
      .map((m) => m.id)

    const toUnset = siblingIds.filter((id) => id !== input.payment_method_id)
    if (toUnset.length) {
      await service.updatePaymentDetails(
        toUnset.map((id) => ({ id, is_default: false }))
      )
    }
    await service.updatePaymentDetails({
      id: input.payment_method_id,
      is_default: true,
    })

    return new StepResponse(
      { payment_method_id: input.payment_method_id },
      { siblingIds, previousDefaults }
    )
  },
  async (
    rollback: { siblingIds: string[]; previousDefaults: string[] },
    { container }
  ) => {
    if (!rollback) return
    const service: InternalPaymentService = container.resolve(
      INTERNAL_PAYMENTS_MODULE
    )
    await service.updatePaymentDetails(
      rollback.siblingIds.map((id) => ({
        id,
        is_default: rollback.previousDefaults.includes(id),
      }))
    )
  }
)

export const setDefaultPaymentMethodWorkflow = createWorkflow(
  "set-default-payment-method",
  (input: SetDefaultPaymentMethodInput) => {
    const result = setDefaultPaymentMethodStep(input)
    return new WorkflowResponse(result)
  }
)
