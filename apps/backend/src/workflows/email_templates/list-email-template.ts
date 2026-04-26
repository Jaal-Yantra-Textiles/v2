import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates";
import EmailTemplateService from "../../modules/email_templates/service";

export type ListEmailTemplateStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listEmailTemplateStep = createStep(
  "list-email-template-step",
  async (input: ListEmailTemplateStepInput, { container }) => {
    const service: EmailTemplateService = container.resolve(EMAIL_TEMPLATES_MODULE);
    const results = await service.listAndCountEmailTemplates(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListEmailTemplateWorkflowInput = ListEmailTemplateStepInput;

export const listEmailTemplateWorkflow = createWorkflow(
  "list-email-template",
  (input: ListEmailTemplateWorkflowInput) => {
    const results = listEmailTemplateStep(input);
    return new WorkflowResponse(results);
  }
);
