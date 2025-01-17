import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { createWebsiteWorkflow } from "../../../workflows/website/create-website";
import { WebsiteSchema } from "./validators";
import {
  ListWebsiteWorkflowInput,
  listWebsiteWorkflow,
} from "../../../workflows/website/list-website";

export const POST = async (
  req: MedusaRequest<WebsiteSchema>,
  res: MedusaResponse,
) => {
 
  const { result } = await createWebsiteWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  res.status(201).json({ website: result });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { q, status } = req.query;
  const name = q;
  const offset = parseInt(req.query.offset as string) || 0;
  const limit = parseInt(req.query.limit as string) || 10;

  const workflowInput: ListWebsiteWorkflowInput = {
    config: {
      relations: ["pages"],
      skip: offset,
      take: limit
    },
    filters: {
      name,
      status,
    }
  };

  const { result } = await listWebsiteWorkflow(req.scope).run({
    input: workflowInput,
  });

  const [websites, count] = result;

  res.json({
    websites,
    count,
    offset,
    limit,
    hasMore: offset + websites.length < count,
  });
};
