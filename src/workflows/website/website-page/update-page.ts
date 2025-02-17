import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";


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
  published_at?: Date | null | undefined;
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
    let updatedPage;
    await websiteService.updatePages(
      {
        selector: {
          id: input.id,
        },
        data: {
          ...input,
          last_modified: new Date()
        },
      }
    ).catch(error => {
      if(error.message.includes("already exist")) {
        throw new MedusaError(
          MedusaError.Types.DUPLICATE_ERROR,
          `Page with slug: ${input.slug} already exist`
        );
      }
    }).then(page => {
      updatedPage = page;
    });

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
     {
      selector: {
        id: compensationData.id
      },
      data: {
        ...compensationData.originalData
      }
     }
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
