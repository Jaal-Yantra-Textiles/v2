import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";

export type ListBlocksStepInput = {
  page_id: string;
  filters?: {
    type?: string;
    status?: "Active" | "Inactive" | "Draft";
    name?: string;
    order?: number;
    created_at?: Date;
    updated_at?: Date;
  };
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
    order?: { [key: string]: "ASC" | "DESC" };
  };
};

export const listBlocksStep = createStep(
  "list-blocks-step",
  async (input: ListBlocksStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // First verify the page exists
    const page = await websiteService.retrievePage(input.page_id);
    if (!page) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Page with id ${input.page_id} not found`
      );
    }

    // Merge page_id with other filters
    const filters = {
      ...input.filters
    };

   

    // Set default config if not provided
    const config = {
      skip: 0,
      take: 10,
      order: { order: "ASC" },
      ...input.config
    };

    // Get blocks with count
    const [blocks, count] = await websiteService.listAndCountBlocks(
      filters,
      config
    );

  

    return new StepResponse({
      blocks,
      count,
      limit: config.take,
      offset: config.skip
    });
  }
);

export type ListBlocksWorkflowInput = ListBlocksStepInput;

export const listBlocksWorkflow = createWorkflow(
  "list-blocks",
  (input: ListBlocksWorkflowInput) => {
    const result = listBlocksStep(input);
    return new WorkflowResponse(result);
  }
);
