import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../modules/website";
import WebsiteService from "../../modules/website/service";

export type DeleteWebsiteStepInput = {
  id: string;
};

export const deleteWebsiteStep = createStep(
  "delete-website-step",
  async (input: DeleteWebsiteStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Get the current state for compensation
    const websiteToDelete = await websiteService.retrieveWebsite(input.id);
    
    // Delete the Website entity
    await websiteService.deleteWebsites(input.id);

    // Return the deleted entity data for compensation
    return new StepResponse({ success: true }, websiteToDelete);
  },
  async (originalWebsite: any, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // Restore the deleted entity to compensate
    await websiteService.createWebsites(originalWebsite);
  },
);

export type DeleteWebsiteWorkflowInput = DeleteWebsiteStepInput;

export const deleteWebsiteWorkflow = createWorkflow(
  "delete-website",
  (input: DeleteWebsiteWorkflowInput) => {
    const result = deleteWebsiteStep(input);
    return new WorkflowResponse(result);
  },
);
