import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {  deleteTagSchema, tagSchema, UpdateTagsForPerson } from "./validators";
import { TagAllowedFields, refetchPersonTags } from "./helpers";

import createPersonTagsWorkflow from "../../../../../workflows/persons/create-person-tags";
import retrievePersonTagsWorkflow from "../../../../../workflows/persons/retrieve-person-tags";
import updatePersonTagsWorkflow from "../../../../../workflows/persons/update-person-tags";
import deletePersonTagsWorkflow from "../../../../../workflows/persons/delete-person-tags";

export const POST = async (
  req: MedusaRequest & {
    remoteQueryConfig?: {
      fields?: TagAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const personId = req.params.id;
  const validatedBody = tagSchema.parse(req.body);
    const { result, errors } = await createPersonTagsWorkflow.run({
      input: {
        person_id: personId,
       ...validatedBody
      },
    });
    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }
  
    const tags = await refetchPersonTags(personId, req.scope);

    res.status(201).json({ tags })
};

export const GET = async (
  req: MedusaRequest & {
    remoteQueryConfig?: {
      fields?: TagAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const personId = req.params.id;

  try {
    const { result, errors } = await retrievePersonTagsWorkflow.run({
      input: {
        person_id: personId,
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    res.status(200).json({ tags: result.tags });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const PUT = async (
  req: MedusaRequest<UpdateTagsForPerson> & {
    remoteQueryConfig?: {
      fields?: TagAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const personId = req.params.id;

  try {
    const { result, errors } = await updatePersonTagsWorkflow.run({
      input: {
        person_id: personId,
        ...req.validatedBody
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const tags = await refetchPersonTags(personId, req.scope);
    res.status(201).json({ tags });
  } catch (error) {
    res.status(400).json({ error: error });
  }
};


