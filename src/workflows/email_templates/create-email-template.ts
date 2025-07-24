import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates";
import EmailTemplateService from "../../modules/email_templates/service";

export type CreateEmailTemplateStepInput = {
  name: string;
  template_key: string;
  subject: string;
  html_content: string;
  variables?: Record<string, unknown> | null;
  template_type: string;
  is_active?: boolean;
  description?: string | null;
  to?: string | null;
  from?: string;
};

export const createEmailTemplateStep = createStep(
  "create-email-template-step",
  async (input: CreateEmailTemplateStepInput, { container }) => {
    const service: EmailTemplateService = container.resolve(EMAIL_TEMPLATES_MODULE);
    const created = await service.createEmailTemplates(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: EmailTemplateService = container.resolve(EMAIL_TEMPLATES_MODULE);
    await service.softDeleteEmailTemplates(id);
  }
);

export type CreateEmailTemplateWorkflowInput = CreateEmailTemplateStepInput;

export const createEmailTemplateWorkflow = createWorkflow(
  "create-email-template",
  (input: CreateEmailTemplateWorkflowInput) => {
    const result = createEmailTemplateStep(input);
    return new WorkflowResponse(result);
  }
);
