import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../modules/website";
import WebsiteService from "../../modules/website/service";

export type UpdateWebsiteStepInput = {
  id: string;
  domain?: string;
  name?: string;
  description?: string;
  status?: "Active" | "Inactive" | "Maintenance" | "Development";
  primary_language?: string;
  supported_languages?: string[];
  favicon_url?: string;
  analytics_id?: string;
  metadata?: Record<string, unknown>;
};

export const updateWebsiteStep = createStep(
  "update-website-step",
  async (input: UpdateWebsiteStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
  
    // Get the current state for compensation
    const originalWebsite = await websiteService.retrieveWebsite(input.id);
    
    // Update the Website entity
    const updatedWebsite = await websiteService.updateWebsites({
      selector:{
      id: input.id,
    },
    data: {
      ...input,
    }
  });

    // Return the updated entity and compensation data
    return new StepResponse(updatedWebsite, {
      id: input.id,
      originalData: originalWebsite
    });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // Restore the original state to compensate
    await websiteService.updateWebsites(
      compensationData.id,
      compensationData.originalData
    );
  },
);

export type UpdateWebsiteWorkflowInput = UpdateWebsiteStepInput;

export const updateWebsiteWorkflow = createWorkflow(
  "update-website",
  (input: UpdateWebsiteWorkflowInput) => {
    const updatedWebsite = updateWebsiteStep(input);
    return new WorkflowResponse(updatedWebsite);
  },
);
