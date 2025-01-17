import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../modules/website";
import WebsiteService from "../../modules/website/service";

export type ListWebsiteStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listWebsiteStep = createStep(
  "list-website-step",
  async (input: ListWebsiteStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // List Website entities
    const websites = await websiteService.listAndCountWebsites(
      input.filters,
      input.config
    );

    return new StepResponse(websites);
  }
);

export type ListWebsiteWorkflowInput = ListWebsiteStepInput;

export const listWebsiteWorkflow = createWorkflow(
  "list-website",
  (input: ListWebsiteWorkflowInput) => {
    const websites = listWebsiteStep(input);
    return new WorkflowResponse(websites);
  },
);
