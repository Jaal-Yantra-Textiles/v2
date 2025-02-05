import {
  MedusaRequest,
  MedusaResponse,
  
} from "@medusajs/framework/http";
import PersonService from "../../../modules/person/service";
import { PERSON_MODULE } from "../../../modules/person";
import { Person } from "./validators";
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

// Valid fields that can be used for filtering
const VALID_FILTER_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'email',
  'date_of_birth',
  'state',
  'q'
] as const;

type ValidFilterField = typeof VALID_FILTER_FIELDS[number];

interface PersonFilters {
  q?: string; 
  [key: string]: any;
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const personService: PersonService = req.scope.resolve(PERSON_MODULE);

  try {
    // Extract only valid filter fields from query
    const filters: PersonFilters = {};
    
    // Always include search query if present
    if (req.query.q) {
      filters.q = req.query.q as string;
    }

    // Add other valid filters
    Object.keys(req.query).forEach(key => {
      if (VALID_FILTER_FIELDS.includes(key as ValidFilterField)) {
        filters[key] = req.query[key];
      }
    });

    const limit = Math.min(Number(req.query.limit) || 10, 10) // Cap at 10 items
    const { result:persons, errors } = await listAndCountPersonsWithFilterWorkflow(req.scope).run({
      input: {
        filters,
        pagination: {
          take: limit,
          skip: Number(req.query.offset) || 0,
          order: {
            created_at: 'ASC'
          }
        }
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
