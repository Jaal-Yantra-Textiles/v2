import { createWorkflow, createStep, StepResponse, transform } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerService from "../../../modules/partner/service"
import { resolveRetailPartnerId } from "../../../modules/partner_billing/resolve-retail-partner"
import {
  confirmationDelivery,
  confirmationLines,
  confirmationPayment,
  confirmationTotals,
} from "./order-confirmation-email-lib"

/**
 * Retrieve the order with what the confirmation renders (#2578): the lines,
 * computed totals, addresses, the shipping method and the payments. Read via
 * `query.graph` so totals come back calculated — the module's retrieveOrder
 * left `total` empty and the email fell back to summing unit prices.
 */
const retrieveOrderStep = createStep(
  { name: "retrieve-order", store: true },
  async ({ orderId }: { orderId: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "sales_channel_id",
        "total",
        "subtotal",
        "item_subtotal",
        "tax_total",
        "shipping_total",
        "discount_total",
        "summary",
        "items.*",
        "shipping_address.*",
        "billing_address.*",
        "shipping_methods.name",
        "payment_collections.captured_amount",
        "payment_collections.authorized_amount",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.data",
      ],
      filters: { id: orderId },
    })
    return new StepResponse(data?.[0] ?? null)
  }
)

/**
 * Build the FLAT template variables the `order-placed` template declares
 * (customer_first_name, order_display_id, order_total, order_email) plus the
 * partner context (partner_name, store_url) so the customer email can carry the
 * partner's branding + storefront link.
 *
 * Previously the workflow passed a nested `{ order, customer: { first_name } }`
 * payload whose keys never matched the template's flat `{{customer_first_name}}`
 * / `{{order_display_id}}` / `{{order_total}}` / `{{order_email}}` variables, so
 * Handlebars rendered every field as an empty string ("Hi ,", "Order #",
 * "Total: "). This step resolves the partner via the retail ownership rule
 * (order.sales_channel_id === store.default_sales_channel_id) and formats money.
 */
const buildOrderConfirmationVarsStep = createStep(
  { name: "build-order-confirmation-vars", store: true },
  async ({ order }: { order: any }, { container }) => {
    // --- Order-level flat vars -------------------------------------------
    const items = (order?.items || []) as any[]
    // Prefer the order's computed grand total (includes shipping + tax); fall
    // back to the line-item subtotal only if the total isn't populated.
    const itemsSubtotal = items.reduce(
      (sum: number, item: any) =>
        sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0),
      0
    )
    const orderTotal =
      Number(order?.total) > 0 ? Number(order.total) : itemsSubtotal || 0

    const firstName =
      order?.shipping_address?.first_name ||
      order?.billing_address?.first_name ||
      (order?.email ? String(order.email).split("@")[0] : "") ||
      "there"

    const customerName =
      `${order?.shipping_address?.first_name || ""} ${order?.shipping_address?.last_name || ""}`.trim() ||
      order?.email ||
      "Customer"

    // --- Partner context: order → (store default sales channel) → partner --
    // Retail ownership rule: order.sales_channel_id === store.default_sales_channel_id
    // (same as validatePartnerOrderOwnership / the fee subscriber).
    let partnerName = ""
    let storeUrl = process.env.FRONTEND_URL || ""

    try {
      const partnerId = await resolveRetailPartnerId(
        container,
        order?.sales_channel_id
      )
      if (partnerId) {
        const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
        const partners = await partnerService.listPartners(
          { id: partnerId },
          { select: ["id", "name", "handle", "storefront_domain", "metadata"] }
        )
        const partner = (partners as any[])?.[0]
        if (partner) {
          partnerName = partner.name || ""
          const domain =
            partner.storefront_domain ||
            partner.metadata?.storefront_domain ||
            ""
          if (domain) {
            storeUrl = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
          }
        }
      }
    } catch (err) {
      console.warn(
        `[order-confirmation] partner context lookup failed for order ${order?.id}: ${(err as Error).message}`
      )
    }

    const vars = {
      customer_first_name: firstName,
      customer_name: customerName,
      order_display_id: order?.display_id ? `#${order.display_id}` : order?.id || "",
      order_id: order?.id || "",
      order_email: order?.email || "",
      order_total: new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: order?.currency_code?.toUpperCase() || "INR",
      }).format(orderTotal),
      item_count: String(items.length),
      partner_name: partnerName,
      store_url: storeUrl,
      current_year: String(new Date().getFullYear()),
      // #2578 — what was bought, what was paid and how, how it will arrive.
      items: confirmationLines(items, order?.currency_code),
      ...confirmationTotals(order),
      payment: confirmationPayment(order),
      delivery: confirmationDelivery(order),
    }

    return new StepResponse(vars)
  }
)

export const sendOrderConfirmationWorkflow = createWorkflow(
  { name: "send-order-confirmation-email", store: true },
  (input: { orderId: string }) => {
    const order = retrieveOrderStep(input)

    const emailData = buildOrderConfirmationVarsStep({ order })

    const templateData = fetchEmailTemplateStep({
      templateKey: "order-placed",
      data: emailData as unknown as Record<string, any>,
    })

    const emailWithTemplate = transform(
      { order, emailData, templateData },
      (d) => ({
        to: d.order.email || "customer@example.com",
        template: "order-placed",
        data: d.emailData,
        templateData: d.templateData,
      })
    )

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
