import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { contactSchema } from "./validators";
import { ContactAllowedFields, refetchPersonContact } from "./helpers";
import { MedusaError } from "@medusajs/utils";
import createContactWorkflow from "../../../../../workflows/persons/create-contact";
import retrieveContactsWorkflow from "../../../../../workflows/persons/retrieve-contacts";

export const POST = async (
  req: MedusaRequest & {
    remoteQueryConfig?: {
      fields?: ContactAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const personId = req.params.id;
  const validatedBody = contactSchema.parse(req.body);

  try {
    const { result, errors } = await createContactWorkflow.run({
      input: {
        person_id: personId,
        ...validatedBody,
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const contact = await refetchPersonContact(
      personId,
      result.id,
      req.scope,
    );

    res.status(201).json({ contact: contact });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const GET = async (
  req: MedusaRequest & {
    remoteQueryConfig?: {
      fields?: ContactAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const personId = req.params.id;

  try {
    const { result, errors } = await retrieveContactsWorkflow.run({
      input: {
        person_id: personId,
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const [contacts, count] = result

    res.status(200).json({ contacts,count });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
