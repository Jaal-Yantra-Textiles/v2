import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";

export type CreateBlockStepInput = {
  page_id: string;
  name: string;
  type: string;
  content: Record<string, unknown>;
  settings?: Record<string, unknown>;
  order?: number;
  status?: "Active" | "Inactive" | "Draft";
  metadata?: Record<string, unknown>;
};

export const createBlockStep = createStep(
  "create-block-step",
  async (input: CreateBlockStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // First verify the page exists
    const page = await websiteService.retrievePage(input.page_id);
    if (!page) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Page with id ${input.page_id} not found`
      );
    }

    // Create the Block entity - any uniqueness violations will be caught by database constraints
    const block = await websiteService.createBlocks({
      ...input
    });

    // Return the created entity and its ID for potential compensation
    return new StepResponse(block, block.id);
  },
  async (id: string, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    // Delete the created block to compensate
    await websiteService.softDeleteBlocks(id);
  }
);

export type CreateBlockWorkflowInput = CreateBlockStepInput;

export const createBlockWorkflow = createWorkflow(
  "create-block",
  (input: CreateBlockWorkflowInput) => {
    const newBlock = createBlockStep(input);
    return new WorkflowResponse(newBlock);
  }
);
