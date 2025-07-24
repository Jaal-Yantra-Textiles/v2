import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { EmailTemplate, ListEmailTemplatesQuery, listEmailTemplatesQuerySchema } from "./validators";
import { refetchEmailTemplate } from "./helpers";
import { createEmailTemplateWorkflow } from "../../../workflows/email_templates/create-email-template";
import { listEmailTemplateWorkflow } from "../../../workflows/email_templates/list-email-template";

export const GET = async (req: MedusaRequest<any, ListEmailTemplatesQuery>, res: MedusaResponse) => {
  const validated = listEmailTemplatesQuerySchema.parse(req.query);
  const { q, template_type, is_active, limit, offset, order } = validated;
  
  const filters: Record<string, any> = {};
  if (template_type) filters.template_type = template_type;
  if (is_active !== undefined) filters.is_active = is_active;
  if (q) {
    // Add search functionality for name, subject, or template_key
    filters.$or = [
      { name: { $ilike: `%${q}%` } },
      { subject: { $ilike: `%${q}%` } },
      { template_key: { $ilike: `%${q}%` } }
    ];
  }
  
  const config: any = {
    take: limit,
    skip: offset,
  };
  
  if (order) {
    const [field, direction] = order.split(':');
    config.order = { [field]: direction || 'ASC' };
  }
  
  const { result } = await listEmailTemplateWorkflow(req.scope).run({
    input: { filters, config },
  });
  
  res.status(200).json({ 
    email_templates: result[0], 
    count: result[1],
    offset,
    limit 
  });
};

export const POST = async (req: MedusaRequest<EmailTemplate>, res: MedusaResponse) => {
  const { result } = await createEmailTemplateWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  const emailTemplate = await refetchEmailTemplate(result.id, req.scope);
  res.status(201).json({ email_template: emailTemplate });
};
