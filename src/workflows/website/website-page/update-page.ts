import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";

export type UpdatePageStepInput = {
  id: string;
  website_id: string;
  title?: string;
  slug?: string;
  content?: string;
  page_type?: "Home" | "About" | "Contact" | "Blog" | "Product" | "Service" | "Portfolio" | "Landing" | "Custom";
  status?: "Draft" | "Published" | "Archived";
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  published_at?: Date | string;
  metadata?: Record<string, unknown>;
};

export const updatePageStep = createStep(
  "update-page-step",
  async (input: UpdatePageStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // First verify the website exists
    await websiteService.retrieveWebsite(input.website_id);
    
    // Get the current state for compensation
    const originalPage = await websiteService.retrievePage(input.id);
    
    // Update the Page entity
    const updatedPage = await websiteService.updatePages(
      {
        selector: {
          id: input.id,
        },
        data: {
          ...input,
          lastModified: new Date()
        },
      }
    );

    // Return the updated entity and compensation data
    return new StepResponse(updatedPage, {
      id: input.id,
      originalData: originalPage
    });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // Restore the original state to compensate
    await websiteService.updatePages(
      compensationData.id,
      compensationData.originalData
    );
  },
);

export type UpdatePageWorkflowInput = UpdatePageStepInput;

export const updatePageWorkflow = createWorkflow(
  "update-page",
  (input: UpdatePageWorkflowInput) => {
    const updatedPage = updatePageStep(input);
    return new WorkflowResponse(updatedPage);
  },
);
