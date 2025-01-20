import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  createHook
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { emitEventStep } from "@medusajs/medusa/core-flows";
import { MedusaError } from "@medusajs/framework/utils";


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

    // Check if a page with this slug already exists
    try {
      const existingPage = await websiteService.retrievePage(input.slug);
      if (existingPage) {
        throw new MedusaError(
          MedusaError.Types.DUPLICATE_ERROR,
          `A page with slug "${input.slug}" already exists. Please use a unique slug.`
        );
      }
    } catch (error) {
      // If error is NOT_FOUND, that's good - means no duplicate
      if (error.type !== MedusaError.Types.NOT_FOUND) {
        throw error;
      }
    }
    
    // Create the Page entity
    const page = await websiteService.createPages({
      ...input,
      last_modified: new Date(),
      published_at: new Date()
    })

    // Return the created entity and its ID for potential compensation
    return new StepResponse(page,page.id);
  },
  async (id: string , { container }) => {
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
    // Emit the page.created event
    emitEventStep({
      eventName: "page.created",
      data: {
        id: newPage.id,
      },
    });

    const pageCreatedHook = createHook(
      "pageCreated",
      { page_id: newPage.id },
    )
    return new WorkflowResponse(newPage, {
      hooks: [pageCreatedHook],
    });
  },
);
