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

    // Build the update payload from `input`, but strip undefined keys
    // so we don't blindly overwrite existing columns (e.g. published_at)
    // when the client didn't send them.
    const data: Record<string, any> = { last_modified: new Date() };
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && k !== "id" && k !== "website_id") {
        data[k] = v;
      }
    }

    // Auto-stamp `published_at` on the Draft→Published transition when
    // the client didn't supply an explicit value. Republishing an
    // already-Published page doesn't re-stamp (preserves the original
    // publish date so feeds + SEO don't churn).
    if (
      input.status === "Published" &&
      originalPage.status !== "Published" &&
      input.published_at === undefined
    ) {
      data.published_at = new Date();
    }

    // Update the Page entity
    let updated: any;
    try {
      updated = await websiteService.updatePages({
        selector: { id: input.id },
        data,
      });
    } catch (error: any) {
      if (error?.message?.includes("already exist")) {
        throw new MedusaError(
          MedusaError.Types.DUPLICATE_ERROR,
          `Page with slug: ${input.slug} already exist`
        );
      }
      throw error;
    }

    // `updatePages` returns an array — unwrap to a single object so
    // downstream `result.id` works. Previously this was the array,
    // which made the route's refetchPage(result.id, …) fall through
    // to `id: undefined` and return an arbitrary first row.
    const updatedPage = Array.isArray(updated) ? updated[0] : updated;

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
