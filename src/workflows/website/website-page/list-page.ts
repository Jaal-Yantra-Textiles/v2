import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";

export type ListPageStepInput = {
  website_id?: string;
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
  async (input: ListPageStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // If website_id is provided, verify the website exists
    if (input.website_id) {
      await websiteService.retrieveWebsite(input.website_id);
    }
    // List Page entities
    const pages = await websiteService.listAndCountPages(
      input.filters,
      input.config
    );

    console.log(pages)

    return new StepResponse(pages);
  }
);

export type ListPageWorkflowInput = ListPageStepInput;

export const listPageWorkflow = createWorkflow(
  "list-page",
  (input: ListPageWorkflowInput) => {
    const pages = listPageStep(input);
    return new WorkflowResponse(pages);
  },
);
