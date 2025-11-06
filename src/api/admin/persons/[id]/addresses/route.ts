import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework/http";

import { Address } from "./validators";
import createAddressWorkflow from "../../../../../workflows/persons/create-address";
import retrieveAddressesWorkflow from "../../../../../workflows/persons/retrieve-addresses";
import { MedusaError } from "@medusajs/framework/utils";

export const POST = async (
  req: MedusaRequest<Address>,
  res: MedusaResponse,
) => {
  
  const personId = req.params.id;
  // Check if the person exists in the personID or is validPersonId
  const existingPerson = await refetchEntity({
    entity: "person",
    idOrFilter: personId,
    scope: req.scope,
    fields: ["id"]
  });
  
  if (!existingPerson) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Person with id "${personId}" not found`,
    );
  }

  const { result, errors } = await createAddressWorkflow.run({
    input: {
      person_id: personId,
      ...req.validatedBody,
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    res.status(400).json({ error: errors });
    throw errors;
  }

  res.status(201).json({ address: result });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const personId = req.params.id;

  try {
    const { result, errors } = await retrieveAddressesWorkflow(req.scope).run({
      input: {
        person_id: personId,
      },
    });

    const [addresses, count] = result

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    res.status(200).json({
      addresses,
      count
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
