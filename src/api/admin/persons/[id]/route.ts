// src/api/admin/persons/[id]/route.ts
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework/http";
import PersonService from "../../../../modules/person/service";
import { PERSON_MODULE } from "../../../../modules/person";
import updatePersonWorkflow from "../../../../workflows/update-person";
import { PersonAllowedFields, refetchPerson } from "../helpers";
import { AdminUpdatePerson } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const personService: PersonService = req.scope.resolve(PERSON_MODULE);
  const { id } = req.params;

  try {
    const person = await personService.retrievePerson(id, {
      relations: ["addresses"],
    });
    res.status(200).json({ person });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

export const POST = async (
  req: MedusaRequest<AdminUpdatePerson> & {
    remoteQueryConfig?: {
      fields?: PersonAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const {  ...update } = req.validatedBody
  const existingPerson = await refetchEntity(
    "person",
    req.params.id,
    req.scope,
    ["id"]
  )

  /**
   * Check if the person exists with the id or not before calling the workflow.
   */
  if (!existingPerson) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Person with id "${req.params.id}" not found`
    )
  }


  const { result, errors, transaction } = await updatePersonWorkflow.run({
    input: {
      id: req.params.id,
      update: update
    },
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

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const personService: PersonService = req.scope.resolve(PERSON_MODULE);
  const { id } = req.params;

  try {
    await personService.deletePeople(id);
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
