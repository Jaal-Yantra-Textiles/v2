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
  const { q, offset: offsetStr, limit: limitStr, ...filters } = req.query;

  const offset = parseInt(offsetStr as string) || 0;
  const limit = parseInt(limitStr as string) || 10;

  if (q) {
    filters.name = q;
  }

  const workflowInput: ListPersonTypesWorkFlowInput = {
    filters: filters,
    pagination: {
      offset,
      limit,
    },
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
