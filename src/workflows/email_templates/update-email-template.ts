import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates";
import EmailTemplateService from "../../modules/email_templates/service";

export type UpdateEmailTemplateStepInput = {
  id: string;
  name?: string;
  description?: string | null;
  to?: string | null;
  from?: string;
  template_key?: string;
  subject?: string;
  html_content?: string;
  variables?: Record<string, unknown> | null;
  template_type?: string;
  is_active?: boolean;
};

export const updateEmailTemplateStep = createStep(
  "update-email-template-step",
  async (input: UpdateEmailTemplateStepInput, { container }) => {
    const service: EmailTemplateService = container.resolve(EMAIL_TEMPLATES_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrieveEmailTemplate(id);

    const updated = await service.updateEmailTemplates({
      selector: { id },
      data: updateData,
    });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: EmailTemplateService = container.resolve(EMAIL_TEMPLATES_MODULE);
    await service.updateEmailTemplates({
      selector: { id: compensationData.id },
      data: compensationData.originalData,
    });
  }
);

export type UpdateEmailTemplateWorkflowInput = UpdateEmailTemplateStepInput;

export const updateEmailTemplateWorkflow = createWorkflow(
  "update-email-template",
  (input: UpdateEmailTemplateWorkflowInput) => {
    const result = updateEmailTemplateStep(input);
    return new WorkflowResponse(result);
  }
);
