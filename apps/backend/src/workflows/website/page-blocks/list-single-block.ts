import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";

export type ListSingleBlockStepInput = {
  block_id: string;
};

export const listSingleBlockStep = createStep(
  "list-single-block-step",
  async (input: ListSingleBlockStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    const block = await websiteService.retrieveBlock(input.block_id);
    if (!block) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Block with id ${input.block_id} not found`
      );
    }

    return new StepResponse(block);
  }
);

export type ListSingleBlockWorkflowInput = ListSingleBlockStepInput;

export const listSingleBlockWorkflow = createWorkflow(
  "list-single-block",
  (input: ListSingleBlockWorkflowInput) => {
    const result = listSingleBlockStep(input);
    return new WorkflowResponse(result);
  }
);
