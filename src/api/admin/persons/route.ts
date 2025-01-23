import {
  MedusaRequest,
  MedusaResponse,
  
} from "@medusajs/framework/http";
import PersonService from "../../../modules/person/service";
import { PERSON_MODULE } from "../../../modules/person";
import { Person, personSchema } from "./validators";
import createPersonWorkflow from "../../../workflows/create-person";
import { PersonAllowedFields, refetchPerson } from "./helpers";

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

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const personService: PersonService = req.scope.resolve(PERSON_MODULE);

  try {
    const [persons, count] = await personService.listAndCountPeople();
    res.status(200).json({
      persons,
      count,
      offset: req.query.offset || 0,
      limit: req.query.limit || 10,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
