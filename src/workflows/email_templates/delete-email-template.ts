import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates";
import EmailTemplateService from "../../modules/email_templates/service";

export type DeleteEmailTemplateStepInput = {
  id: string;
};

export const deleteEmailTemplateStep = createStep(
  "delete-email-template-step",
  async (input: DeleteEmailTemplateStepInput, { container }) => {
    const service: EmailTemplateService = container.resolve(EMAIL_TEMPLATES_MODULE);
    const original = await service.retrieveEmailTemplate(input.id);

    await service.deleteEmailTemplates(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: EmailTemplateService = container.resolve(EMAIL_TEMPLATES_MODULE);
    await service.createEmailTemplates(original);
  }
);

export type DeleteEmailTemplateWorkflowInput = DeleteEmailTemplateStepInput;

export const deleteEmailTemplateWorkflow = createWorkflow(
  "delete-email-template",
  (input: DeleteEmailTemplateWorkflowInput) => {
    const result = deleteEmailTemplateStep(input);
    return new WorkflowResponse(result);
  }
);
