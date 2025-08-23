import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates"
import EmailTemplatesService from "../../modules/email_templates/service"
import * as Handlebars from "handlebars"

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
    const notificationService = container.resolve(Modules.NOTIFICATION)
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

// Order confirmation workflow - simplified approach
export const sendOrderConfirmationWorkflow = createWorkflow(
  "send-order-confirmation-email",
  (input: { orderId: string }) => {
    const retrieveOrderStep = createStep(
      "retrieve-order",
      async ({ orderId }: { orderId: string }, { container }) => {
        const orderService = container.resolve(Modules.ORDER)
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
        const customerService = container.resolve(Modules.CUSTOMER)
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
