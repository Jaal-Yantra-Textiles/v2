import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";

import { CreateBlockStepInput } from "./create-block";
import { Block } from "../../../../.medusa/types/query-entry-points";

export type CreateBatchBlocksStepInput = {
  blocks: CreateBlockStepInput[];
};

export const createBatchBlocksStep = createStep(
  "create-batch-blocks-step",
  async (input: CreateBatchBlocksStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    const createdBlocks: Block[] = [];
    const errors: Array<{ type: string; page_id: string; error: string }> = [];

    // Group blocks by page_id for efficient validation
    const blocksByPage = input.blocks.reduce((acc, block) => {
      acc[block.page_id] = acc[block.page_id] || [];
      acc[block.page_id].push(block);
      return acc;
    }, {} as Record<string, CreateBlockStepInput[]>);

    // Process blocks page by page
    for (const [pageId, blocks] of Object.entries(blocksByPage)) {
      try {
        // Verify the page exists (once per page)
        const page = await websiteService.retrievePage(pageId);
        if (!page) {
          blocks.forEach(block => {
            errors.push({
              type: block.type,
              page_id: pageId,
              error: `Page with id ${pageId} not found`
            });
          });
          continue;
        }

        // Process each block for this page
        for (const block of blocks) {
          try {
            // Create the block - any uniqueness violations will be caught by database constraints
            const newBlock = await websiteService.createBlocks({
              ...block
            });

            createdBlocks.push(newBlock);
          } catch (error) {
            errors.push({
              type: block.type,
              page_id: pageId,
              error: error.message
            });
          }
        }
      } catch (error) {
        blocks.forEach(block => {
          errors.push({
            type: block.type,
            page_id: pageId,
            error: error.message
          });
        });
      }
    }

    return new StepResponse(
      {
        created: createdBlocks,
        errors: errors.length > 0 ? errors : []
      },
      createdBlocks.map(b => b.id)
    );
  },
  async (ids: string[], { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    // Delete all created blocks to compensate
    for (const id of ids) {
      await websiteService.softDeleteBlocks(id);
    }
  }
);

export const createBatchBlocksWorkflow = createWorkflow(
  "create-batch-blocks",
  (input: CreateBatchBlocksStepInput) => {
    const result = createBatchBlocksStep(input);

    // Transform the result to get block IDs
    const blockIds = transform(
      result,
      (data) => data.created.map((block: Block) => ({ id: block.id }))
    );

    return new WorkflowResponse(result);
  }
);
