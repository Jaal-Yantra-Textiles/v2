import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { DeleteBlockSchema, UpdateBlockSchema } from "../validators";
import { updateBlockWorkflow } from "../../../../../../../../workflows/website/page-blocks/update-block";
import { refetchBlock } from "../helpers";
import { deleteBlockWorkflow } from "../../../../../../../../workflows/website/page-blocks/delete-block";
import { listSingleBlockWorkflow } from "../../../../../../../../workflows/website/page-blocks/list-single-block";

export const PUT = async (
    req: MedusaRequest<UpdateBlockSchema>,
    res: MedusaResponse,
  ) => {
    const blockId = req.params.blockId;
    const { result } = await updateBlockWorkflow(req.scope).run({
      input: {
        block_id: blockId,
        ...req.validatedBody
      },
    });
  
    const block = await refetchBlock(result.id, req.params.pageId, req.scope);
    res.json(block);
  };

  export const GET = async (
    req: MedusaRequest,
    res: MedusaResponse,
  ) => {
    const blockId = req.params.blockId;
    const { result } = await listSingleBlockWorkflow(req.scope).run({
      input: {
        block_id: blockId,
      },
    });

    res.json({
      block: result
    });
  };

export const DELETE = async (
    req: MedusaRequest,
    res: MedusaResponse,
  ) => {
    
    const blockId = req.params.blockId;
    const { result } = await deleteBlockWorkflow(req.scope).run({
      input: {
        block_id: blockId,
      },
    });
  
    res.json({
      id: blockId,
      object: "block",
      deleted: true,
    });
};