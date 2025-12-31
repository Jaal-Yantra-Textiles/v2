import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { EMAIL_TEMPLATES_MODULE } from "../../../modules/email_templates"
import EmailTemplatesService from "../../../modules/email_templates/service"
import * as Handlebars from "handlebars"
import type { ProcessedEmailTemplateData } from "../types"

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

// Step to fetch and process email template data from database
export const fetchEmailTemplateStep = createStep(
  { name: "fetch-email-template", store: true },
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
