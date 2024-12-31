import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { addressSchema } from "../validators";
import { refetchPersonAddress, AddressAllowedFields } from "../helpers";
import { MedusaError } from "@medusajs/utils";
import updateAddressWorkflow from "../../../../../../workflows/persons/update-address";
import deleteAddressWorkflow from "../../../../../../workflows/persons/delete-address";

export const POST = async (
  req: MedusaRequest & {
    remoteQueryConfig?: {
      fields?: AddressAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const personId = req.params.id;
  const addressId = req.params.addressId;

  // Make all fields optional for update
  const updateAddressSchema = addressSchema.partial();
  const validatedBody = updateAddressSchema.parse(req.body);

  // Check if the address exists for this person
  const existingAddress = await refetchPersonAddress(
    personId,
    addressId,
    req.scope,
  );

  if (!existingAddress) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Address with id "${addressId}" not found for person "${personId}"`
    );
  }

  try {
    const { result, errors } = await updateAddressWorkflow.run({
      input: {
        id: addressId,
        person_id: personId,
        update: validatedBody,
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    // Refetch the updated address to get the latest state
    const updatedAddress = await refetchPersonAddress(
      personId,
      addressId,
      req.scope,
      req.remoteQueryConfig?.fields || ["*"],
    );

    res.status(200).json({ address: updatedAddress });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const personId = req.params.id;
  const addressId = req.params.addressId;
 
  

  try {
    // Check if the address exists for this person
  const existingAddress = await refetchPersonAddress(
    personId,
    addressId,
    req.scope,
  );

  if (!existingAddress) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Address with id "${addressId}" not found for person "${personId}"`
    );
  }
    const { result, errors } = await deleteAddressWorkflow.run({
      input: {
        person_id: personId,
        id: addressId,
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    res.status(204).end();
  } catch (error) {
    throw error;
  }
};
