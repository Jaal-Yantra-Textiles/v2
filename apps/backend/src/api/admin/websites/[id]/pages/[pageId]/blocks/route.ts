/**
 * @route POST /admin/websites/:id/pages/:pageId/blocks
 * @description Create blocks for a specific page
 * @body {CreateBlocksSchema | BlockSchema} - Either a single block or batch of blocks
 * @param {string} pageId - The ID of the page to create blocks for
 * @returns {Object} - Response with created blocks or errors
 * @example
 * // Create a single block
 * POST /admin/websites/123/pages/456/blocks
 * {
 *   "type": "text",
 *   "content": "Hello World",
 *   "position": 1
 * }
 * @example
 * // Create multiple blocks
 * POST /admin/websites/123/pages/456/blocks
 * {
 *   "blocks": [
 *     {
 *       "type": "text",
 *       "content": "First block",
 *       "position": 1
 *     },
 *     {
 *       "type": "image",
 *       "url": "/path/to/image.jpg",
 *       "position": 2
 *     }
 *   ]
 * }
 * @response 201 - All blocks created successfully
 * @response 207 - Some blocks created, some failed
 * @response 400 - Failed to create blocks
 */

/**
 * @route GET /admin/websites/:id/pages/:pageId/blocks
 * @description List blocks for a specific page
 * @param {string} pageId - The ID of the page to list blocks for
 * @query {Object} - Optional query parameters for pagination and filtering
 * @returns {Object} - Response with blocks, count, offset, and limit
 * @example
 * GET /admin/websites/123/pages/456/blocks?offset=0&limit=10
 * @response 200 - List of blocks
 * {
 *   "blocks": [
 *     {
 *       "id": "1",
 *       "type": "text",
 *       "content": "Hello World",
 *       "position": 1
 *     }
 *   ],
 *   "count": 1,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
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



