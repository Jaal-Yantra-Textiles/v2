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
  supported_languages?: Record<string, unknown> | null;
  favicon_url?: string;
  analytics_id?: string;
  analytics_provider?: "in_house" | "custom" | "off";
  analytics_custom_head?: string | null;
  analytics_custom_body_end?: string | null;
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

    // Mirror the primary domain into the website_domain alias table so
    // find-website-by-domain can resolve it via either path.
    await websiteService.ensurePrimaryWebsiteDomain(newWebsite.id, newWebsite.domain);

    // Return the created entity and its ID for potential compensation
    return new StepResponse(newWebsite, newWebsite.id);
  },
  async (id: string | undefined, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    if (!id) {
      return;
    }
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
