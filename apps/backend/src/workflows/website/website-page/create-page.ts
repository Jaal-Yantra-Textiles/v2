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
  published_at?: Date | string | null;
  metadata?: Record<string, unknown>;
  genMetaDataLLM: boolean;
};

export const createPageStep = createStep(
  "create-page-step",
  async (input: CreatePageStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
      // First verify the website exists
      await websiteService.retrieveWebsite(input.website_id);
      
      // Only stamp `published_at` when the page is created in a
      // Published state and the client didn't supply one. Previously
      // we always stamped — which left Draft pages with a publish
      // date (visible bug example: page 01JQ4HWCE05SD9WKDDNZ9A45KY
      // had status=Draft + published_at=2025-03-24).
      const shouldAutoStamp =
        input.status === "Published" &&
        (input.published_at === undefined || input.published_at === null);

      const page = await websiteService.createPages({
        ...input,
        last_modified: new Date(),
        ...(shouldAutoStamp ? { published_at: new Date() } : {}),
      })

      // Return the created entity and its ID for potential compensation
      return new StepResponse(page, page.id); 
  },
  async (id: string , { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    // Delete the created page to compensate
    await websiteService.softDeletePages(id);
  },
);

export type CreatePageWorkflowInput = CreatePageStepInput;

export const createPageWorkflow = createWorkflow(
  {
    name: "create-page",
    store: true,
    storeExecution: true,
  },
  (input: CreatePageWorkflowInput) => {
    const newPage = createPageStep(input);
    // Emit the page.created event
    emitEventStep({
      eventName: "page.created",
      data: {
        id: newPage.id,
        genMetaDataLLM: input.genMetaDataLLM
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
