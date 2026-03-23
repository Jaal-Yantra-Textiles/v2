import {
  createWorkflow,
  createStep,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/types"
import {
  resolvePartnerFromOrderStep,
  PartnerOrderContext,
} from "../steps/resolve-partner-from-order"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import * as Handlebars from "handlebars"
import { EMAIL_TEMPLATES_MODULE } from "../../../modules/email_templates"
import EmailTemplatesService from "../../../modules/email_templates/service"

// ---------------------------------------------------------------------------
// Shared step: send the actual partner email to each active admin
// ---------------------------------------------------------------------------

const sendPartnerOrderNotificationStep = createStep(
  { name: "send-partner-order-notification", store: true },
  async (
    input: {
      context: PartnerOrderContext
      templateKey: string
      extraData?: Record<string, any>
    },
    { container }
  ) => {
    const { context, templateKey, extraData } = input
    const { order, partner, partnerAdmins, partnerFromEmail, partnerFromName } =
      context

    if (!partner || partnerAdmins.length === 0) {
      console.log(
        `[partner-order-email] No partner/admins for order ${order?.id} — skipping`
      )
      return new StepResponse({ sent: 0, skipped: true })
    }

    // Fetch and compile the template
    const emailTemplatesService: EmailTemplatesService =
      container.resolve(EMAIL_TEMPLATES_MODULE)
    const template = await emailTemplatesService.getTemplateByKey(templateKey)

    const compiledHtml = Handlebars.compile(template.html_content)
    const compiledSubject = Handlebars.compile(template.subject)

    const notificationService = container.resolve(
      Modules.NOTIFICATION
    ) as INotificationModuleService

    let sentCount = 0

    // Compute order-level template data once
    const orderItems = (order?.items || []) as any[]
    const orderTotal =
      orderItems.reduce(
        (sum: number, item: any) =>
          sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0),
        0
      ) || 0

    for (const admin of partnerAdmins) {
      const templateData = {
        // Partner info
        partner_name: partner.name,
        partner_handle: partner.handle,

        // Admin info
        admin_name: `${admin.first_name} ${admin.last_name}`.trim(),
        admin_first_name: admin.first_name,

        // Order info
        order_display_id: order?.display_id || order?.id || "",
        order_id: order?.id || "",
        order_email: order?.email || "",
        order_total: new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: order?.currency_code?.toUpperCase() || "INR",
        }).format(orderTotal),
        item_count: String(orderItems.length),
        customer_name: `${order?.shipping_address?.first_name || ""} ${order?.shipping_address?.last_name || ""}`.trim() || order?.email || "Customer",
        customer_email: order?.email || "",

        // Metadata
        current_year: String(new Date().getFullYear()),
        store_url: process.env.FRONTEND_URL || "",

        // Extra data (e.g., tracking, cancellation reason)
        ...extraData,
      }

      const renderedHtml = compiledHtml(templateData)
      const renderedSubject = compiledSubject(templateData)

      try {
        await notificationService.createNotifications({
          to: admin.email,
          channel: "email_partner",
          template: templateKey,
          data: {
            ...templateData,
            _template_subject: renderedSubject,
            _template_html_content: renderedHtml,
            _template_from: partnerFromEmail,
            _template_processed: true,
            _partner_from_email: partnerFromEmail,
            _partner_from_name: partnerFromName,
          },
        })
        sentCount++
        console.log(
          `[partner-order-email] Sent ${templateKey} to ${admin.email} (partner: ${partner.name})`
        )
      } catch (err) {
        console.error(
          `[partner-order-email] Failed to send ${templateKey} to ${admin.email}: ${(err as Error).message}`
        )
      }
    }

    return new StepResponse({ sent: sentCount, skipped: false })
  }
)

// ---------------------------------------------------------------------------
// Workflow: Partner Order Placed
// ---------------------------------------------------------------------------

export const sendPartnerOrderPlacedWorkflow = createWorkflow(
  { name: "send-partner-order-placed-email", store: true },
  (input: { orderId: string }) => {
    const context = resolvePartnerFromOrderStep({ orderId: input.orderId })
    const result = sendPartnerOrderNotificationStep({
      context,
      templateKey: "partner-order-placed",
    })
    return new WorkflowResponse(result)
  }
)

// ---------------------------------------------------------------------------
// Workflow: Partner Order Fulfilled
// ---------------------------------------------------------------------------

export const sendPartnerOrderFulfilledWorkflow = createWorkflow(
  { name: "send-partner-order-fulfilled-email", store: true },
  (input: {
    orderId: string
    trackingNumber?: string
    carrierName?: string
    trackingUrl?: string
  }) => {
    const context = resolvePartnerFromOrderStep({ orderId: input.orderId })

    const extraData = transform({ input }, (data) => ({
      tracking_number: data.input.trackingNumber || "",
      carrier_name: data.input.carrierName || "",
      tracking_url: data.input.trackingUrl || "",
    }))

    const result = sendPartnerOrderNotificationStep({
      context,
      templateKey: "partner-order-fulfilled",
      extraData,
    })
    return new WorkflowResponse(result)
  }
)

// ---------------------------------------------------------------------------
// Workflow: Partner Order Canceled
// ---------------------------------------------------------------------------

export const sendPartnerOrderCanceledWorkflow = createWorkflow(
  { name: "send-partner-order-canceled-email", store: true },
  (input: { orderId: string; cancellationReason?: string }) => {
    const context = resolvePartnerFromOrderStep({ orderId: input.orderId })

    const extraData = transform({ input }, (data) => ({
      cancellation_reason: data.input.cancellationReason || "",
    }))

    const result = sendPartnerOrderNotificationStep({
      context,
      templateKey: "partner-order-cancelled",
      extraData,
    })
    return new WorkflowResponse(result)
  }
)
