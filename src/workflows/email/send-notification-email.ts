import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates"
import EmailTemplatesService from "../../modules/email_templates/service"
import * as Handlebars from "handlebars"
import type {
  ICustomerModuleService,
  IFulfillmentModuleService,
  INotificationModuleService,
  IOrderModuleService,
} from "@medusajs/types"

interface SendNotificationEmailInput {
  to: string
  template: string
  data?: Record<string, any>
}

interface EmailTemplateData {
  subject: string
  html_content: string
  from?: string
  variables?: Record<string, unknown>
}

interface ProcessedEmailTemplateData {
  subject: string
  html_content: string
  from?: string
  processed: boolean
}

type ShipmentStatusVariant = "shipped" | "delivered"

let templateHelpersRegistered = false

const registerEmailTemplateHelpers = () => {
  if (templateHelpersRegistered) {
    return
  }

  Handlebars.registerHelper("formatDate", function (value: any, options: Handlebars.HelperOptions) {
    try {
      const locale = options?.hash?.locale || "en-US"
      const dateStyle = options?.hash?.dateStyle || "medium"
      const date = new Date(value)

      if (isNaN(date.getTime())) {
        return value ?? ""
      }

      return new Intl.DateTimeFormat(locale, { dateStyle }).format(date)
    } catch {
      return value ?? ""
    }
  })

  Handlebars.registerHelper("formatYear", function (value: any) {
    const date = new Date(value)
    if (isNaN(date.getTime())) {
      return value ?? ""
    }

    return `${date.getFullYear()}`
  })

  Handlebars.registerHelper("formatMoney", function (
    currencyCode: string,
    amount: number,
    options: Handlebars.HelperOptions
  ) {
    try {
      const locale = options?.hash?.locale || "en-US"
      const formatter = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currencyCode?.toUpperCase?.() || "USD",
      })

      return formatter.format(Number(amount) || 0)
    } catch {
      return `${amount ?? 0} ${currencyCode ?? ""}`.trim()
    }
  })

  Handlebars.registerHelper("capitalize", function (value: string) {
    if (typeof value !== "string" || !value.length) {
      return value ?? ""
    }

    return value.charAt(0).toUpperCase() + value.slice(1)
  })

  templateHelpersRegistered = true
}

interface SendShipmentStatusEmailInput {
  shipment_id: string
  status: ShipmentStatusVariant
}

const SHIPMENT_TEMPLATE_CONFIG: Record<
  ShipmentStatusVariant,
  {
    templateKey: string
    statusCopy: string
    badgeColor: string
  }
> = {
  shipped: {
    templateKey: "order-shipment-created",
    statusCopy: "Your items are on the way. Track the package below.",
    badgeColor: "bg-sky-600",
  },
  delivered: {
    templateKey: "order-shipment-delivered",
    statusCopy: "Your parcel was delivered. Let us know if anything looks off.",
    badgeColor: "bg-emerald-600",
  },
}

// Step to fetch and process email template data from database
export const fetchEmailTemplateStep = createStep(
  "fetch-email-template",
  async (input: { templateKey: string; data?: Record<string, any> }, { container }) => {
    const emailTemplatesService: EmailTemplatesService = container.resolve(EMAIL_TEMPLATES_MODULE)
    
    const template = await emailTemplatesService.getTemplateByKey(input.templateKey)
     
    // Process the template with Handlebars if data is provided
    let processedHtmlContent = template.html_content
    let processedSubject = template.subject
    
    if (input.data) {
      try {
        registerEmailTemplateHelpers()
        // Filter out internal template fields from variable processing
        const filteredData = Object.keys(input.data)
          .filter(key => !key.startsWith('_template_'))
          .reduce((obj, key) => {
            obj[key] = input.data![key]
            return obj
          }, {} as Record<string, any>)
        
        console.log('Processing template with data:', Object.keys(filteredData))
        
        // Compile and render the HTML template
        const htmlTemplate = Handlebars.compile(template.html_content)
        processedHtmlContent = htmlTemplate(filteredData)
        
        // Compile and render the subject template
        const subjectTemplate = Handlebars.compile(template.subject)
        processedSubject = subjectTemplate(filteredData)
        
        
      } catch (error) {
        console.error(`Failed to process template with Handlebars: ${error.message}`)
        // Keep original template content if processing fails
      }
    }
    
    const processedTemplateData = {
      subject: processedSubject,
      html_content: processedHtmlContent,
      from: template.from,
      processed: true
    } as ProcessedEmailTemplateData
    
    console.log('Returning processed template data')
    return new StepResponse(processedTemplateData)
  }
)

export const sendNotificationEmailStep = createStep(
  "send-notification-email",
  async (input: SendNotificationEmailInput & { templateData?: ProcessedEmailTemplateData | null }, { container }) => {
    const notificationService = container.resolve(Modules.NOTIFICATION) as INotificationModuleService
    console.log('Send notification input:', input)
    console.log('Template data received:', input.templateData)
    
    // Prepare the data to send to the notification service
    const notificationData = {
      ...input.data,
      // Include processed template data if available
      ...(input.templateData && {
        _template_subject: input.templateData.subject,
        _template_html_content: input.templateData.html_content,
        _template_from: input.templateData.from,
        _template_processed: input.templateData.processed,
      })
    }
    
    console.log('Notification data being sent:', notificationData)

    const result = await notificationService.createNotifications({
      to: input.to,
      channel: "email",
      template: input.template,
      data: notificationData,
    })

    return new StepResponse(result, { notificationId: result.id })
  }
)

export const sendNotificationEmailWorkflow = createWorkflow(
  "send-notification-email",
  (input: SendNotificationEmailInput) => {
    // First fetch and process the email template data with the provided data
    const templateData = fetchEmailTemplateStep({ 
      templateKey: input.template,
      data: input.data
    })
    
    // Transform the input and template data together
    const combinedInput = transform({ input, templateData }, (data) => {
      return {
        ...data.input,
        templateData: data.templateData
      }
    })
    
    // Then send the notification with the processed template data
    const result = sendNotificationEmailStep(combinedInput)
    
    return new WorkflowResponse(result)
  }
)

const retrieveShipmentDetailsStep = createStep(
  "retrieve-shipment-details",
  async ({ shipment_id }: { shipment_id: string }, { container }) => {
    const query:any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "fulfillment",
      fields: [
        "id",
        "labels.tracking_number",
        "labels.tracking_url",
        "labels.label_url",
        "items.id",
        "items.title",
        "items.quantity",
        "items.sku",
        "order.id",
        "order.display_id",
        "order.email",
        "order.currency_code",
        "order.created_at",
        "order.subtotal",
        "order.shipping_total",
        "order.tax_total",
        "order.total",
        "order.shipping_address.first_name",
        "order.shipping_address.last_name",
        "order.shipping_address.address_1",
        "order.shipping_address.address_2",
        "order.shipping_address.city",
        "order.shipping_address.postal_code",
        "order.shipping_address.country_code",
        "order.shipping_address.phone",
      ],
      filters: { id: shipment_id },
    })

    const fulfillment = data?.[0]

    if (!fulfillment) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Fulfillment with id "${shipment_id}" was not found`
      )
    }

    const order = fulfillment.order

    if (!order) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Fulfillment "${shipment_id}" is not linked to an order`
      )
    }

    const shippingAddress = order.shipping_address || null
    const customerEmail = order.email || ""
    const customerName =
      shippingAddress?.first_name || shippingAddress?.last_name
        ? `${shippingAddress?.first_name || ""} ${shippingAddress?.last_name || ""}`.trim()
        : customerEmail || "Customer"

    const labels = Array.isArray(fulfillment.labels) ? fulfillment.labels : []
    const trackingNumbers = labels
      .map((label: any) => label?.tracking_number)
      .filter(Boolean)

    const trackingLinks = labels
      .map((label: any) => {
        const trackingUrl = label?.tracking_url || label?.label_url
        if (!trackingUrl) {
          return null
        }

        return {
          url: trackingUrl,
          label: label?.tracking_number || "Track shipment",
        }
      })
      .filter(Boolean)

    return new StepResponse({
      fulfillment,
      order,
      shippingAddress,
      items: fulfillment.items || [],
      customer_email: customerEmail,
      customer_name: customerName,
      trackingNumbers,
      trackingLinks,
    })
  }
)

export const sendShipmentStatusEmail = createWorkflow(
  "send-shipment-status-email",
  (input: SendShipmentStatusEmailInput) => {
    const shipmentData = retrieveShipmentDetailsStep({
      shipment_id: input.shipment_id,
    })

    const emailInput = transform({ shipmentData, input }, ({ shipmentData, input }) => {
      const config = SHIPMENT_TEMPLATE_CONFIG[input.status] ?? SHIPMENT_TEMPLATE_CONFIG.shipped

      const trackingLinks = shipmentData.trackingLinks || []
      const trackingNumbers = shipmentData.trackingNumbers || []
      const formattedItems = (shipmentData.items || []).map((item: any) => ({
        id: item.id,
        title: item.title || "Item",
        sku: item.sku,
        quantity: item.quantity,
      }))

      return {
        to: shipmentData.customer_email,
        template: config.templateKey,
        data: {
          customer_name: shipmentData.customer_name,
          status_copy: config.statusCopy,
          status_badge_class: config.badgeColor,
          order_id: shipmentData.order.display_id || shipmentData.order.id,
          order_date: shipmentData.order.created_at,
          fulfillment_id: shipmentData.fulfillment.id,
          shipment_status: input.status,
          tracking_numbers: trackingNumbers,
          tracking_links: trackingLinks,
          items: formattedItems,
          shipping_address: shipmentData.shippingAddress,
          order_totals: {
            subtotal: shipmentData.order.subtotal,
            shipping_total: shipmentData.order.shipping_total,
            tax_total: shipmentData.order.tax_total,
            total: shipmentData.order.total,
            currency_code: shipmentData.order.currency_code,
          },
        },
      }
    })

    const result = sendNotificationEmailWorkflow.runAsStep({
      input: emailInput,
    })

    return new WorkflowResponse(result)
  }
)

// Order confirmation workflow - simplified approach
export const sendOrderConfirmationWorkflow = createWorkflow(
  "send-order-confirmation-email",
  (input: { orderId: string }) => {
    const retrieveOrderStep = createStep(
      "retrieve-order",
      async ({ orderId }: { orderId: string }, { container }) => {
        const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
        const order = await orderService.retrieveOrder(orderId, {
          relations: ["customer", "items"],
        })
        return new StepResponse(order)
      }
    )

    const order = retrieveOrderStep(input)
    
    sendNotificationEmailStep({
      to: order.email || "customer@example.com",
      template: "order-placed",
      data: {
        order,
        customer: order.customer_id ? { first_name: "Customer" } : null,
      },
    })
  }
)

// Welcome email workflow
export const sendWelcomeEmailWorkflow = createWorkflow(
  "send-welcome-email",
  (input: { customerId: string }) => {
    const retrieveCustomerStep = createStep(
      "retrieve-customer",
      async ({ customerId }: { customerId: string }, { container }) => {
        const customerService = container.resolve(Modules.CUSTOMER) as ICustomerModuleService
        const customer = await customerService.retrieveCustomer(customerId)
        return new StepResponse(customer)
      }
    )

    const customer = retrieveCustomerStep(input)
    
    sendNotificationEmailStep({
      to: customer.email,
      template: "customer-created",
      data: {
        customer_name: customer.first_name || "Customer",
        customer,
      },
    })
  }
)

// Password reset workflow
export const sendPasswordResetWorkflow = createWorkflow(
  "send-password-reset-email",
  (input: { email: string; resetUrl: string }) => {
    sendNotificationEmailStep({
      to: input.email,
      template: "password-reset",
      data: {
        reset_url: input.resetUrl,
      },
    })
  }
)

// Admin partner creation email workflow
export const sendAdminPartnerCreationEmail = createWorkflow(
  "send-admin-partner-creation-email",
  (input: { to: string; partner_name: string; temp_password: string }) => {
    // Reuse the generic email workflow with our specific template and data
    const result = sendNotificationEmailWorkflow.runAsStep({
      input: {
        to: input.to,
        template: "partner-created-from-admin",
        data: {
          partner_name: input.partner_name,
          temp_password: input.temp_password,
        },
      },
    })

    return new WorkflowResponse(result)
  }
)

// Order fulfillment email workflow
export const sendOrderFulfillmentEmail = createWorkflow(
  "send-order-fulfillment-email",
  (input: { order_id: string; fulfillment_id: string }) => {
    const retrieveOrderDataStep = createStep(
      "retrieve-order-fulfillment-data",
      async ({ order_id, fulfillment_id }: { order_id: string; fulfillment_id: string }, { container }) => {
        const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
        const fulfillmentService = container.resolve(Modules.FULFILLMENT) as IFulfillmentModuleService
        
        // Retrieve order with shipping address
        const order = await orderService.retrieveOrder(order_id, {
          relations: ["shipping_address"],
        })
        
        // Retrieve the specific fulfillment with its items
        const fulfillment = await fulfillmentService.retrieveFulfillment(fulfillment_id, {
          relations: ["items"],
        })
        
        return new StepResponse({
          order,
          fulfillment,
          customer_email: order.email || "",
          customer_name: "Customer",
        })
      }
    )

    const orderData = retrieveOrderDataStep(input)
    
    // Transform to prepare email data
    const emailInput = transform({ orderData }, (data) => ({
      to: data.orderData.customer_email,
      template: "order-fulfillment-procured",
      data: {
        customer_name: data.orderData.customer_name,
        order_id: data.orderData.order.display_id || data.orderData.order.id,
        order_date: data.orderData.order.created_at,
        // Use fulfillment items instead of all order items
        items: data.orderData.fulfillment.items || [],
        fulfillment_id: data.orderData.fulfillment.id,
        shipping_address: data.orderData.order.shipping_address,
        // Additional fulfillment details
        total_items_fulfilled: data.orderData.fulfillment.items?.length || 0,
      },
    }))
    
    const result = sendNotificationEmailWorkflow.runAsStep({
      input: emailInput,
    })

    return new WorkflowResponse(result)
  }
)
