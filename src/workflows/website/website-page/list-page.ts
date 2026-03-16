import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";

export type ListPageWorkflowInput = {
  /** Required — pages are always scoped to a website */
  website_id: string;
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listPageStep = createStep(
  "list-page-step",
  async (input: ListPageWorkflowInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    if (!input.website_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "website_id is required to list pages"
      );
    }

    // Verify the website exists
    await websiteService.retrieveWebsite(input.website_id);

    // Always scope pages to the website
    const filters = {
      ...input.filters,
      website_id: input.website_id,
    };

    const pages = await websiteService.listAndCountPages(
      filters,
      input.config
    );

    return new StepResponse(pages);
  }
);

export const listPageWorkflow = createWorkflow(
  "list-page",
  (input: ListPageWorkflowInput) => {
    const pages = listPageStep(input);
    return new WorkflowResponse(pages);
  },
);
