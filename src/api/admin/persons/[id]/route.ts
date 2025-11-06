// src/api/admin/persons/[id]/route.ts
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework/http";
import PersonService from "../../../../modules/person/service";
import { PERSON_MODULE } from "../../../../modules/person";
import updatePersonWorkflow from "../../../../workflows/update-person";
import { PersonAllowedFields, refetchPerson } from "../helpers";

import { MedusaError } from "@medusajs/framework/utils";
import { AdminUpdatePerson } from "../../../../admin/hooks/api/personandtype";
import listSinglePersonWorkflow from "../../../../workflows/persons/list-single-person";
import deletePersonWorkflow from "../../../../workflows/delete-person";

export const GET = async (req: MedusaRequest , res: MedusaResponse) => {
  const { id } = req.params;
  const { result: person } = await listSinglePersonWorkflow(req.scope).run({
    input: {
      id,
      ...req.queryConfig
    },
  });
  res.status(200).json({ person });
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
  const existingPerson = await refetchEntity({
    entity: "person",
    idOrFilter: req.params.id,
    scope: req.scope,
    fields: ["id"]
  })

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
  const { id } = req.params;
    const {result, errors} = await  deletePersonWorkflow(req.scope).run({
      input: {
        id,
      },
    });
    if (errors.length > 1) {
      console.warn("Error reported at", errors);
      throw errors;
    }
    res.status(201).json({
      id,
      object: "person",
      deleted: true,
    });
};
