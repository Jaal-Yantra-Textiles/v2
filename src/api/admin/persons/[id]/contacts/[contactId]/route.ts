import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { contactSchema } from "../validators";
import { refetchPersonContact, ContactAllowedFields } from "../helpers";
import { MedusaError } from "@medusajs/utils";
import updateContactWorkflow from "../../../../../../workflows/persons/update-contact";
import deleteContactWorkflow from "../../../../../../workflows/persons/delete-contact";

export const POST = async (
  req: MedusaRequest & {
    remoteQueryConfig?: {
      fields?: ContactAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const personId = req.params.id;
  const contactId = req.params.contactId;

  // Make all fields optional for update
  const updateContactSchema = contactSchema.partial();
  const validatedBody = updateContactSchema.parse(req.body);

  try {
    // Check if the contact exists for this person
    const existingContact = await refetchPersonContact(
      personId,
      contactId,
      req.scope,
    );

    if (!existingContact) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Contact with id "${contactId}" not found for person "${personId}"`
      );
    }

    const { result, errors } = await updateContactWorkflow.run({
      input: {
        id: contactId,
        person_id: personId,
        ...validatedBody,
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    // Refetch the updated contact to get the latest state
    const updatedContact = await refetchPersonContact(
      personId,
      result.id,
      req.scope,
    );

    res.status(200).json({ contact: updatedContact });
  } catch (error) {
    console.log(error)
    res.status(400).json({ error: error.message });
  }
};

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const personId = req.params.id;
  const contactId = req.params.contactId;

  try {
    // Check if the contact exists for this person
    const existingContact = await refetchPersonContact(
      personId,
      contactId,
      req.scope,
    );

    if (!existingContact) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Contact with id "${contactId}" not found for person "${personId}"`
      );
    }

    const { result, errors } = await deleteContactWorkflow.run({
      input: {
        person_id: personId,
        id: contactId,
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    res.status(204).end();
  } catch (error) {
    console.log(error);
    throw error;
  }
};
