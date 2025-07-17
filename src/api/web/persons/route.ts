import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listPublicPersonsWorkflow } from "../../../workflows/persons/list-public-persons";
import { ListPublicPersonsQuery } from "./validators";

export const GET = async (req: MedusaRequest<ListPublicPersonsQuery>, res: MedusaResponse) => {
  // Validate query parameters
  
  // Exclude pagination fields to get only filter parameters
  const { limit, offset, ...filters } = req.validatedQuery;

  console.log(filters)

  const { result: persons, errors } = await listPublicPersonsWorkflow(req.scope).run({
    input: {
      filters,
      pagination: {
        take: req.validatedQuery.limit,
        skip: req.validatedQuery.offset,
        order: {
          created_at: 'ASC'
        }
      },
    }
  });

  if (errors && errors.length > 0) {
    throw new Error(errors.map(e => e.error.message).join('\n'));
  }

  res.status(200).json({
    persons: persons.data,
    count: persons.metadata?.count,
    offset: req.validatedQuery.offset,
    limit: req.validatedQuery.limit,
  });
};
