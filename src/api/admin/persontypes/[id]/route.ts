import {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { DeletePersonTypeSchema, UpdatePersonTypeSchema } from "../validators";
import { deletePersonTypeWorkflow } from "../../../../workflows/person_type/delete-person_type";
import { PERSON_TYPE_MODULE } from "../../../../modules/persontype";
import PersonTypeService from "../../../../modules/persontype/service";
import { AdminPersonTypeResponse } from "@medusajs/framework/types";
import { PersonTypeAllowedFields, refetchPersonType } from "../helpers";
import { MedusaError } from "@medusajs/framework/utils";
import { updatePersonTypeWorkflow } from "../../../../workflows/person_type/update-person_type";

export const DELETE = async (
  req: MedusaRequest<DeletePersonTypeSchema>,
  res: MedusaResponse,
) => {
  const { id } = req.params;

  const { result, errors } = await deletePersonTypeWorkflow(req.scope).run({
    input: {
      id: id,
    },
  });
  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }
  res.status(200).json({
    id,
    object: "personType",
    deleted: true,
  });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const personTypeService: PersonTypeService =
    req.scope.resolve(PERSON_TYPE_MODULE);
  const { id } = req.params;

  try {
    const personType = await personTypeService.retrievePersonType(id);
    res.status(200).json({ personType });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

export const POST = async (
  req: AuthenticatedMedusaRequest<UpdatePersonTypeSchema> & {
    remoteQueryConfig?: {
      fields?: PersonTypeAllowedFields[];
    };
  },
  res: MedusaResponse<AdminPersonTypeResponse>,
) => {
  const existingPersonType = await refetchPersonType(req.params.id, req.scope, [
    "id",
  ]);

  if (!existingPersonType) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Person type with id "${req.params.id}" not found`,
    );
  }

  const { result } = await updatePersonTypeWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      name: req.validatedBody.name,
      description: req.validatedBody.description,
    },
  });

  const fieldsToFetch: PersonTypeAllowedFields[] =
    req.remoteQueryConfig?.fields || [];
    
  const personType = await refetchPersonType(
    result.id,
    req.scope,
    fieldsToFetch,
  );

  res.status(200).json({ personType: personType });
};
