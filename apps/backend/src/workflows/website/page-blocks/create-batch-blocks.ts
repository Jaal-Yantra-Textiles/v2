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

const UNIQUE_BLOCK_TYPES = [
  "Hero",
  "Header",
  "Footer",
  "MainContent",
  "ContactForm",
];

type Block = {
  id: string;
  name: string;
  type: string;
  content: Record<string, unknown>;
  settings?: Record<string, unknown> | null;
  order?: number;
  status?: "Active" | "Inactive" | "Draft";
  metadata?: Record<string, unknown> | null;
};

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

        // Fetch existing blocks for this page so we can pre-check unique types
        const [existingBlocks] = await websiteService.listAndCountBlocks({
          page_id: pageId,
        });
        const existingUniqueTypes = new Set(
          (existingBlocks || [])
            .filter((b: any) =>
              UNIQUE_BLOCK_TYPES.includes(b.type)
            )
            .map((b: any) => b.type)
        );

        // Process each block for this page
        for (const block of blocks) {
          // Pre-check: reject duplicate unique block types with a friendly message
          if (
            UNIQUE_BLOCK_TYPES.includes(block.type) &&
            existingUniqueTypes.has(block.type)
          ) {
            errors.push({
              type: block.type,
              page_id: pageId,
              error: `A ${block.type} block already exists on this page. Only one ${block.type} is allowed per page.`
            });
            continue;
          }

          try {
            const newBlock = await websiteService.createBlocks({
              ...block
            });

            createdBlocks.push(newBlock);
            if (UNIQUE_BLOCK_TYPES.includes(block.type)) {
              existingUniqueTypes.add(block.type);
            }
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
