import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";

export type DeleteBlockStepInput = {
  block_id: string;
};

export const deleteBlockStep = createStep(
  "delete-block-step",
  async (input: DeleteBlockStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // Verify block exists and get its data for compensation
    const block = await websiteService.retrieveBlock(input.block_id);
    if (!block) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Block with id ${input.block_id} not found`
      );
    }

    // Soft delete the block
    await websiteService.softDeleteBlocks(input.block_id);

    return new StepResponse(block, block);
  },
  async (block: any, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Restore the deleted block
    await websiteService.restoreBlocks(block.id, {
      ...block,
      id: undefined // Remove id as it will be restored with the same id
    });
  }
);

export type DeleteBlockWorkflowInput = DeleteBlockStepInput;

export const deleteBlockWorkflow = createWorkflow(
  "delete-block",
  (input: DeleteBlockWorkflowInput) => {
    const result = deleteBlockStep(input);
    return new WorkflowResponse(result);
  }
);
