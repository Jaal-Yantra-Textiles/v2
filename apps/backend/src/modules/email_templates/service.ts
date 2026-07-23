import { MedusaService, MedusaError } from "@medusajs/framework/utils";
import EmailTemplate from "./models/email-template";

class EmailTemplatesService extends MedusaService({
  EmailTemplate,
}) {
  // Get template by template key, with optional locale-based resolution.
  // Falls back to "en" if the requested locale isn't found, then to any available locale.
  async getTemplateByKey(templateKey: string, locale?: string) {
    const locales = locale && locale !== "en" ? [locale, "en"] : ["en"]
    
    for (const l of locales) {
      const [templates] = await this.listAndCountEmailTemplates({
        template_key: templateKey,
        locale: l as any,
        is_active: true,
      })
      if (templates && templates.length > 0) {
        return templates[0]
      }
    }

    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Email template with key "${templateKey}" not found or inactive`
    )
  }

  // Get template by type
  async getTemplateByType(templateType: string) {
    const [templates, count] = await this.listAndCountEmailTemplates({
      template_type: templateType,
      is_active: true,
    })
    
    if (!templates || templates.length === 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Email template with type "${templateType}" not found or inactive`
      )
    }
    
    return templates[0]
  }

  // Get template with variable substitution
  async getProcessedTemplate(templateKey: string, variables: Record<string, any> = {}) {
    const template = await this.getTemplateByKey(templateKey)
    
    if (!template) {
      return null
    }

    let processedHtml = template.html_content
    let processedSubject = template.subject

    // Replace variables in both HTML content and subject
    Object.keys(variables).forEach(key => {
      const placeholder = `{{${key}}}`
      const value = String(variables[key] || '')
      processedHtml = processedHtml.replace(new RegExp(placeholder, 'g'), value)
      processedSubject = processedSubject.replace(new RegExp(placeholder, 'g'), value)
    })

    return {
      ...template,
      html_content: processedHtml,
      subject: processedSubject,
    }
  }
}

export default EmailTemplatesService;
