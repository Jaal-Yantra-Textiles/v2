// src/api/admin/persons/[id]/route.ts
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework/http";
import PersonService from "../../../../modules/person/service";
import { PERSON_MODULE } from "../../../../modules/person";
import updatePersonWorkflow from "../../../../workflows/update-person";
import { PersonAllowedFields, refetchPerson } from "../helpers";

import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { AdminUpdatePerson } from "../../../../admin/hooks/api/personandtype";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  try {
    // Fetch person details
    const { data: person } = await query.graph({
      entity: "person",
      filters: { id },
      fields: [
        "*",
        "person_type.*"
        // "id",
        // "first_name",
        // "last_name",
        // "email",
        // "date_of_birth",
        // "metadata",
        // "created_at",
        // "updated_at",
        // "deleted_at",
        // "state",
        // "avatar",
        // "addresses.*",
        // "contact_details.*",
        // "tags.*",
        // "person_type.*",
      ],
    });

    if (!person?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Person with id "${id}" not found`
      );
    }

    res.status(200).json({ person: person[0] });
  } catch (error) {
    if (error instanceof MedusaError) {
      throw error;
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      error.message
    );
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
