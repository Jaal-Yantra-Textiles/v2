import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { createPersonTypeWorkflow } from "../../../workflows/person_type/create-person_type";
import {  PersonTypeSchema } from "./validators";

import {
  ListPersonTypesWorkFlowInput,
  listPersonTypeWorkflow,
} from "../../../workflows/person_type/list-person_type";


export const POST = async (
  req: MedusaRequest<PersonTypeSchema>,
  res: MedusaResponse,
) => {
  const { result } = await createPersonTypeWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  res.status(201).json({ personType: result });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { q } = req.query;
  const name = q;
  const offset = parseInt(req.query.offset as string) || 0;
  const limit = parseInt(req.query.limit as string) || 10;

  const workflowInput: ListPersonTypesWorkFlowInput = {
    filters: {
      name,
      // Add other filters based on parsed query parameters
    },
    pagination: {
      offset,
      limit,
    },
    // Include other properties like offset, limit, order if necessary
  };
  const { result } = await listPersonTypeWorkflow(req.scope).run({
    input: workflowInput,
  });

  const [personTypes, count] = result;

  res.json({
    personTypes,
    count,
    offset,
    limit,
    hasMore: offset + personTypes.length < count,
  });
};
