import {
  MedusaRequest,
  MedusaResponse,
  
} from "@medusajs/framework/http";
import PersonService from "../../../modules/person/service";
import { PERSON_MODULE } from "../../../modules/person";
import { Person, ListPersonsQuery } from "./validators";
import createPersonWorkflow from "../../../workflows/create-person";
import { PersonAllowedFields, refetchPerson } from "./helpers";
import { listAndCountPersonsWithFilterWorkflow } from "../../../workflows/persons/list-and-count-with-filter.ts/list-and-count-with-filter";

export const POST = async (
  req: MedusaRequest<Person> & {
    remoteQueryConfig?: {
      fields?: PersonAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const { result, errors, transaction } = await createPersonWorkflow.run({
    input: req.validatedBody,
  });
  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }
  const person = await refetchPerson(
    result.id,
    req.scope,
    req.remoteQueryConfig?.fields || ["*"],
  );
  res.status(201).json({ person });
};

export const GET = async (req: MedusaRequest<ListPersonsQuery>, res: MedusaResponse) => {
  const personService: PersonService = req.scope.resolve(PERSON_MODULE);

  try {
    // Use the validated query parameters
    const query = req.validatedQuery;
    
    // Extract filters directly from the validated query
    // This works because our validator schema matches the filter fields
    const filters = {
      q: query.q,
      first_name: query.first_name,
      last_name: query.last_name,
      email: query.email,
      state: query.state
    };
    
    // Get the validated limit and offset
    const { result:persons, errors } = await listAndCountPersonsWithFilterWorkflow(req.scope).run({
      input: {
        filters,
        pagination: {
          take: query.limit,
          skip: query.offset,
          order: {
            created_at: 'ASC'
          }
        },
        withDeleted: Boolean(query.withDeleted)
      }
    })

    
    res.status(200).json({
      persons: persons.data,
      count: persons.metadata?.count,
      offset: req.query.offset || 0,
      limit: req.query.limit || 10,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
