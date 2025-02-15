import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import {
  createBlockWorkflow,
} from "../../../../../../../workflows/website/page-blocks/create-block";
import {
  createBatchBlocksWorkflow,
} from "../../../../../../../workflows/website/page-blocks/create-batch-blocks";
import {
  listBlocksWorkflow,
} from "../../../../../../../workflows/website/page-blocks/list-blocks";
import { BlockSchema, CreateBlocksSchema } from "./validators";


export const POST = async (
  req: MedusaRequest<CreateBlocksSchema | BlockSchema>,
  res: MedusaResponse,
) => {
  const pageId = req.params.pageId;

  if ('blocks' in req.validatedBody) {
    // Batch create blocks using the bulk workflow
    const { result } = await createBatchBlocksWorkflow(req.scope).run({
      input: {
        blocks: req.validatedBody.blocks.map(block => ({
          ...block,
          page_id: pageId,
        })),
      },
    });

    // Handle response based on creation results
    if (result.errors.length > 0) {
      if (!result.created || result.created.length === 0) {
        res.status(400).json({
          message: "Failed to create blocks",
          errors: result.errors
        });
      } else {
        res.status(207).json({
          message: "Some blocks were created successfully while others failed",
          blocks: result.created,
          errors: result.errors
        });
      }
    } else {
      res.status(201).json({
        message: "All blocks created successfully",
        blocks: result.created
      });
    }
  } else {
    // Create single block
    const { result } = await createBlockWorkflow(req.scope).run({
      input: {
        ...req.validatedBody,
        page_id: pageId,
      },
    });

    res.status(201).json({
      message: "Block created successfully",
      block: result
    });
  }
};

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const pageId = req.params.pageId;
  // change here to the validated query later.
  const { result } = await listBlocksWorkflow(req.scope).run({
    input: {
      page_id: pageId,
      ...req.validatedQuery,
    },
  });

  res.json({
    blocks: result.blocks,
    count: result.count,
    offset: result.offset,
    limit: result.limit,
  });
};



