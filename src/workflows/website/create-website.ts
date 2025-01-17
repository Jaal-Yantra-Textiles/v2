import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../modules/website";
import WebsiteService from "../../modules/website/service";

export type CreateWebsiteStepInput = {
  domain: string;
  name: string;
  description?: string;
  status?: "Active" | "Inactive" | "Maintenance" | "Development";
  primary_language?: string;
  supported_languages?: string[];
  favicon_url?: string;
  analytics_id?: string;
  metadata?: Record<string, unknown>;
};

export const createWebsiteStep = createStep(
  "create-website-step",
  async (input: CreateWebsiteStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    // Create the Website entity
    const newWebsite = await websiteService.createWebsites({
      ...input
    });

    // Return the created entity and its ID for potential compensation
    return new StepResponse(newWebsite, newWebsite.id);
  },
  async (id: string, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // Delete the created entity to compensate
    await websiteService.softDeleteWebsites(id);
  },
);

export type CreateWebsiteWorkflowInput = CreateWebsiteStepInput;

export const createWebsiteWorkflow = createWorkflow(
  "create-website",
  (input: CreateWebsiteWorkflowInput) => {
    const newWebsite = createWebsiteStep(input);
    return new WorkflowResponse(newWebsite);
  },
);
