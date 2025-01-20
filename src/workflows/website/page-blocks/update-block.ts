import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";

export type UpdateBlockStepInput = {
  block_id: string;
  name?: string;
  type?: string;
  content?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  order?: number;
  status?: "Active" | "Inactive" | "Draft";
  metadata?: Record<string, unknown>;
};

export const updateBlockStep = createStep(
  "update-block-step",
  async (input: UpdateBlockStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // Get the existing block
    const existingBlock = await websiteService.retrieveBlock(input.block_id);
    if (!existingBlock) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Block with id ${input.block_id} not found`
      );
    }

    // If type is being changed, check for uniqueness constraints
    if (input.type && input.type !== existingBlock.type) {
      const uniqueBlocks = ["Hero", "Header", "Footer", "MainContent", "ContactForm"];
      if (uniqueBlocks.includes(input.type)) {
        const existingTypeBlock = await websiteService.listBlocks({
            page_id: existingBlock.page_id,
            type: input.type
          
        });

        if (existingTypeBlock.length > 0) {
          throw new MedusaError(
            MedusaError.Types.DUPLICATE_ERROR,
            `A block of type ${input.type} already exists for this page`
          );
        }
      }
    }

    // Update the block
    const updatedBlock = await websiteService.updateBlocks({
      selector: {
        id: input.block_id
      },
      data:{
        ...input,
        block_id: undefined // Remove block_id as it's not part of the update data
      }
    });

    return new StepResponse(updatedBlock, {
      blockId: input.block_id,
      previousData: existingBlock
    });
  },
  async (compensation: { blockId: string; previousData: any }, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Restore the block to its previous state
    await websiteService.updateBlocks(compensation.blockId, {
      ...compensation.previousData,
      id: undefined // Remove id as it's not part of the update data
    });
  }
);

export type UpdateBlockWorkflowInput = UpdateBlockStepInput;

export const updateBlockWorkflow = createWorkflow(
  "update-block",
  (input: UpdateBlockWorkflowInput) => {
    const result = updateBlockStep(input);
    return new WorkflowResponse(result);
  }
);
