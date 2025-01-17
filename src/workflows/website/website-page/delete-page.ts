import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";

export type DeletePageStepInput = {
  id: string;
};

export const deletePageStep = createStep(
  "delete-page-step",
  async (input: DeletePageStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Get the current state for compensation
    const pageToDelete = await websiteService.retrievePage(input.id);
    
    // Delete the Page entity
    await websiteService.deletePages(input.id);

    // Return the deleted entity data for compensation
    return new StepResponse({ success: true }, pageToDelete);
  },
  async (originalPage: any, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // Restore the deleted page to compensate
    await websiteService.createPages(originalPage);
  },
);

export type DeletePageWorkflowInput = DeletePageStepInput;

export const deletePageWorkflow = createWorkflow(
  "delete-page",
  (input: DeletePageWorkflowInput) => {
    const result = deletePageStep(input);
    return new WorkflowResponse(result);
  },
);
