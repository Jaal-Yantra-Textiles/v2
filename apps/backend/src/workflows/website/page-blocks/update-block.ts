import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";
import Block from "../../../modules/website/models/blocks";
import { InferTypeOf } from "@medusajs/framework/types"
export type Block = InferTypeOf<typeof Block>;

export type UpdateBlockStepInput = {
  block_id: string;
  name?: string;
  type?: string;
  content?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  order?: number;
  status?: "Active" | "Inactive" | "Draft";
  metadata?: Record<string, unknown> ;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Deep-merge `patch` onto `base`, recursing into plain objects and replacing
 * arrays/primitives wholesale. Used so a partial `content`/`settings` payload
 * updates only the keys it names instead of replacing the whole JSON column
 * (Medusa writes model.json() columns as a full replace) — see #1016.
 */
const deepMerge = (
  base: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> => {
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      isPlainObject(value) && isPlainObject(out[key])
        ? deepMerge(out[key], value)
        : value;
  }
  return out;
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

    // Update the block. `updateBlocks` returns an array; unwrap so
    // downstream `result.id` works in the route handler. Without this
    // the PUT route's refetchBlock(result.id, ...) fell through to
    // `{ id: undefined }` and returned an arbitrary first block row
    // (same shape as the page PUT bug fixed in #285).
    // Preserve sibling keys in the JSON columns: deep-merge any partial
    // `content`/`settings` payload onto the existing block instead of letting
    // Medusa full-replace the column and drop keys the caller didn't send (#1016).
    const { content: inputContent, settings: inputSettings, ...rest } = input;
    const data: Record<string, unknown> = { ...rest };
    if (inputContent !== undefined) {
      data.content = deepMerge(existingBlock.content, inputContent);
    }
    if (inputSettings !== undefined) {
      data.settings = deepMerge(existingBlock.settings, inputSettings);
    }

    const updatedRaw = await websiteService.updateBlocks({
      selector: {
        id: input.block_id
      },
      data,
    }) as unknown;
    const updatedBlock = (Array.isArray(updatedRaw) ? updatedRaw[0] : updatedRaw) as Block;

    return new StepResponse(updatedBlock, {
      blockId: input.block_id,
      previousData: existingBlock
    });
  },
  async (compensation: { blockId: string; previousData: any }, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Restore the block to its previous state
    await websiteService.updateBlocks({
      selector: {
        id: compensation.blockId
      },
      data: {
        ...compensation.previousData,
      }
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
