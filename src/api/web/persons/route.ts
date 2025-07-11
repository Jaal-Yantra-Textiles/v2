import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listPublicPersonsWorkflow } from "../../../workflows/persons/list-public-persons";
import { ListPublicPersonsQuery, listPublicPersonsQuerySchema } from "./validators";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // Validate query parameters
  const validatedQuery: ListPublicPersonsQuery = listPublicPersonsQuerySchema.parse(req.query);

  const filters = {
    q: validatedQuery.q,
  };

  const { result: persons, errors } = await listPublicPersonsWorkflow(req.scope).run({
    input: {
      filters,
      pagination: {
        take: validatedQuery.limit,
        skip: validatedQuery.offset,
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
    offset: validatedQuery.offset,
    limit: validatedQuery.limit,
  });
};
