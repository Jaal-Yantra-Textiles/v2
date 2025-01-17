import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";

export type CreatePageStepInput = {
  website_id: string;
  title: string;
  slug: string;
  content: string;
  page_type?: "Home" | "About" | "Contact" | "Blog" | "Product" | "Service" | "Portfolio" | "Landing" | "Custom";
  status?: "Draft" | "Published" | "Archived";
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  published_at?: Date | string;
  metadata?: Record<string, unknown>;
};

export const createPageStep = createStep(
  "create-page-step",
  async (input: CreatePageStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // First verify the website exists
    await websiteService.retrieveWebsite(input.website_id);
    
    // Create the Page entity
    const newPage = await websiteService.createPages({
      ...input,
      last_modified: new Date()
    });

    // Return the created entity and its ID for potential compensation
    return new StepResponse(newPage, newPage.id);
  },
  async (id: string, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // Delete the created page to compensate
    await websiteService.softDeletePages(id);
  },
);

export type CreatePageWorkflowInput = CreatePageStepInput;

export const createPageWorkflow = createWorkflow(
  "create-page",
  (input: CreatePageWorkflowInput) => {
    const newPage = createPageStep(input);
    return new WorkflowResponse(newPage);
  },
);
