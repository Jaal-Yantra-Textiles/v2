import { createWorkflow, createStep, StepResponse, transform } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerService from "../../../modules/partner/service"

/**
 * Retrieve the order with the relations we need to render the confirmation.
 * Addresses give us the customer name (line items don't), items give us the
 * total and item count.
 */
const retrieveOrderStep = createStep(
  { name: "retrieve-order", store: true },
  async ({ orderId }: { orderId: string }, { container }) => {
    const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
    const order = await orderService.retrieveOrder(orderId, {
      relations: ["items", "shipping_address", "billing_address"],
    })
    return new StepResponse(order)
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
 * "Total: "). This step resolves the partner via
 * order → sales_channel → store → partner_store link and formats the money.
 */
const buildOrderConfirmationVarsStep = createStep(
  { name: "build-order-confirmation-vars", store: true },
  async ({ order }: { order: any }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

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

    // --- Partner context: order → sales_channel → store → partner --------
    let partnerName = ""
    let storeUrl = process.env.FRONTEND_URL || ""

    try {
      let storeId: string | null = null
      if (order?.sales_channel_id) {
        const { data: scLinks } = await query.graph({
          entity: "sales_channel",
          fields: ["id", "store.id"],
          filters: { id: order.sales_channel_id },
        })
        storeId = scLinks?.[0]?.store?.id || null
      }

      if (storeId) {
        const { data: partnerStoreLinks } = await query.graph({
          entity: "partner_partner_store_store",
          fields: ["partner_id"],
          filters: { store_id: storeId },
          pagination: { skip: 0, take: 1 },
        })
        const partnerId = partnerStoreLinks?.[0]?.partner_id || null

        if (partnerId) {
          const partnerService: PartnerService =
            container.resolve(PARTNER_MODULE)
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
              storeUrl = /^https?:\/\//i.test(domain)
                ? domain
                : `https://${domain}`
            }
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
