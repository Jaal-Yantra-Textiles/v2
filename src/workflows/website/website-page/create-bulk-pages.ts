import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  createHook,
  transform
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { emitEventStep } from "@medusajs/medusa/core-flows";
import { MedusaError } from "@medusajs/framework/utils";
import { CreatePageStepInput } from "./create-page";
import { InferTypeOf } from "@medusajs/framework/types"
import  Page  from "../../../modules/website/models/page";
export type PageObject = InferTypeOf<typeof Page>

export type CreateBulkPagesStepInput = {
  pages: CreatePageStepInput[];
};

export const createBulkPagesStep = createStep(
  "create-bulk-pages-step",
  async (input: CreateBulkPagesStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    const createdPages: PageObject[] = [];
    const errors: Array<{ slug: string; error: string }> = [];

    // Check each page for existing slugs and create if unique
    for (const pageInput of input.pages) {
      try {
        // Verify the website exists (only need to do this once)
        if (createdPages.length === 0) {
          await websiteService.retrieveWebsite(pageInput.website_id);
        }

        // Check for existing page with this slug
        try {
          const existingPage = await websiteService.retrievePage(pageInput.slug);
          if (existingPage) {
            errors.push({
              slug: pageInput.slug,
              error: `Page with slug: ${pageInput.slug}, already exists.`
            });
            continue;
          }
        } catch (error) {
          // If error is NOT_FOUND, that's good - means no duplicate
          if (error.type !== MedusaError.Types.NOT_FOUND) {
            errors.push({
              slug: pageInput.slug,
              error: error.message
            });
            continue;
          }
        }

        // Create the page
        const page = await websiteService.createPages({
          ...pageInput,
          last_modified: new Date(),
          published_at: new Date()
        });

        createdPages.push(page);
      } catch (error) {
        errors.push({
          slug: pageInput.slug,
          error: error.message
        });
      }
    }

    // Return both created pages and errors
    return new StepResponse(
      {
        created: createdPages,
        errors: errors.length > 0 ? errors : []
      },
      createdPages.map(p => p.id)
    );
  },
  async (ids: string[], { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    // Delete all created pages to compensate
    for (const id of ids) {
      await websiteService.softDeletePages(id);
    }
  }
);

export const createBulkPagesWorkflow = createWorkflow(
  "create-bulk-pages",
  (input: CreateBulkPagesStepInput) => {
    const result = createBulkPagesStep(input);

    // Transform the result to get page IDs for events
    const pageIds = transform(
      result,
      (data) => data.created.map((page: PageObject) => ({ id: page.id }))
    );

    // Emit events using transformed data
    transform(
      pageIds,
      (data) => data.forEach(({ id }) => 
        emitEventStep({
          eventName: "page.created",
          data: { id },
        })
      )
    );

    // Create hooks using transformed data
    const hooks = transform(
      pageIds,
      (data) => data.map(({ id }) => 
        createHook("pageCreated", { page_id: id })
      )
    );

    return new WorkflowResponse(result, { hooks });
  }
);
