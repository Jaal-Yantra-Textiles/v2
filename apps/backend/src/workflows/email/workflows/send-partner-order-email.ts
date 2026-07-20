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
    const {
      order,
      partner,
      partnerAdmins,
      partnerFromEmail,
      partnerFromName,
      storeName,
      storeUrl,
    } = context

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
    const currency = order?.currency_code?.toUpperCase() || "INR"
    const money = (amount: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
      }).format(Number(amount) || 0)

    // Prefer the order's computed grand total (shipping + tax); fall back to the
    // line-item subtotal only when the total isn't populated.
    const itemsSubtotal = orderItems.reduce(
      (sum: number, item: any) =>
        sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0),
      0
    )
    const orderTotal =
      Number(order?.total) > 0 ? Number(order.total) : itemsSubtotal || 0

    // Line items for the template — with thumbnails (backfilled in the resolve
    // step), variant title, quantity and line total.
    const lineItems = orderItems.map((item: any) => {
      const quantity = Number(item?.quantity) || 0
      const lineTotal = (Number(item?.unit_price) || 0) * quantity
      return {
        title: item?.product_title || item?.title || "Item",
        variant_title: item?.variant_title || item?.subtitle || "",
        quantity: String(quantity),
        price: money(lineTotal),
        unit_price: money(Number(item?.unit_price) || 0),
        thumbnail: item?.thumbnail || "",
      }
    })

    // Partner-facing order link (admin dashboard partner order view).
    const backendUrl =
      process.env.MEDUSA_ADMIN_BACKEND_URL || process.env.BACKEND_URL || ""
    const orderUrl =
      storeUrl && order?.id
        ? `${storeUrl.replace(/\/$/, "")}/orders/${order.id}`
        : backendUrl && order?.id
          ? `${backendUrl.replace(/\/$/, "")}/app/orders/${order.id}`
          : ""

    const ship = order?.shipping_address || {}

    for (const admin of partnerAdmins) {
      const templateData = {
        // Partner / store info
        partner_name: partner.name,
        partner_handle: partner.handle,
        store_name: storeName || partner.name,

        // Admin info
        admin_name: `${admin.first_name} ${admin.last_name}`.trim(),
        admin_first_name: admin.first_name || partner.name,

        // Order info
        order_display_id: order?.display_id || order?.id || "",
        order_id: order?.id || "",
        order_email: order?.email || "",
        order_total: money(orderTotal),
        item_count: String(orderItems.length),
        items: lineItems,
        payment_status: order?.payment_status || "pending",
        customer_name: `${ship.first_name || ""} ${ship.last_name || ""}`.trim() || order?.email || "Customer",
        customer_email: order?.email || "",

        // Shipping address
        shipping_address_line1: ship.address_1 || "",
        shipping_address_line2: ship.address_2 || "",
        shipping_city: ship.city || "",
        shipping_postal_code: ship.postal_code || "",
        shipping_country: (ship.country_code || "").toUpperCase(),

        // Links / metadata
        order_url: orderUrl,
        store_url: storeUrl || "",
        current_year: String(new Date().getFullYear()),

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
