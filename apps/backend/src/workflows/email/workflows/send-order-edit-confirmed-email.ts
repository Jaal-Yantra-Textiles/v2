import {
  createWorkflow,
  createStep,
  StepResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import {
  buildOrderEditConfirmedVars,
  type OrderEditAction,
} from "./order-edit-confirmed-email-lib"

/**
 * The order as the confirmation email needs it: addresses give the customer's
 * name (line items do not), and `summary` carries the pending difference the
 * template shows as "Additional amount".
 */
const retrieveOrderStep = createStep(
  { name: "retrieve-order-for-edit-confirmation", store: true },
  async ({ orderId }: { orderId: string }, { container }) => {
    const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
    const order = await orderService.retrieveOrder(orderId, {
      relations: ["items", "shipping_address", "billing_address"],
    })
    return new StepResponse(order)
  }
)

/**
 * Tell the CUSTOMER their order edit was applied.
 *
 * Mirrors `sendOrderCanceledCustomerEmailWorkflow`: retrieve → flat vars →
 * render the DB template → send on the `email` channel (Resend in prod). The
 * send/skip decision lives in the subscriber via
 * `shouldSendOrderEditConfirmedEmail`; this workflow assumes it should send.
 *
 * The `order-edit-confirmed` template already existed and was active — it just
 * had nothing calling it.
 */
export const sendOrderEditConfirmedEmailWorkflow = createWorkflow(
  { name: "send-order-edit-confirmed-email", store: true },
  (input: { orderId: string; actions?: OrderEditAction[] | null }) => {
    const order = retrieveOrderStep(input)

    const emailData = transform({ order, input }, (d) =>
      buildOrderEditConfirmedVars({
        order: d.order,
        actions: d.input.actions ?? null,
      })
    )

    const templateData = fetchEmailTemplateStep({
      templateKey: "order-edit-confirmed",
      data: emailData as unknown as Record<string, any>,
    })

    const emailWithTemplate = transform(
      { order, emailData, templateData },
      (d) => ({
        to: d.order.email as string,
        template: "order-edit-confirmed",
        data: d.emailData,
        templateData: d.templateData,
      })
    )

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
