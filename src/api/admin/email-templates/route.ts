import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { refetchEmailTemplate } from "./helpers";
import { createEmailTemplateWorkflow } from "../../../workflows/email_templates/create-email-template";
import { listEmailTemplateWorkflow } from "../../../workflows/email_templates/list-email-template";
import { CreateEmailTemplate, EmailTemplateQueryParams } from "./validators";

export const GET = async (req: MedusaRequest<EmailTemplateQueryParams>, res: MedusaResponse) => {
  const { limit, offset, order, fields, q, is_active, template_type, template_key, ...filters } = req.validatedQuery;
  
  const searchFilters: any = {
    is_active,
    template_type,
    template_key,
    ...filters
  };
  
  if (q) {
    searchFilters.q = q;
  }
  
  const { result } = await listEmailTemplateWorkflow(req.scope).run({
    input: {
      filters: searchFilters,
      config: {
        take: limit,
        skip: offset,
      }
    },
  });
  res.status(200).json({ emailTemplates: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<CreateEmailTemplate>, res: MedusaResponse) => {
  const { result } = await createEmailTemplateWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  const emailTemplate = await refetchEmailTemplate(result.id, req.scope);
  res.status(201).json({ emailTemplate });
};
