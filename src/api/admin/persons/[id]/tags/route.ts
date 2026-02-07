/**
 * @file Admin API routes for managing person tags
 * @description Provides endpoints for creating, retrieving, and updating tags for persons in the JYT Commerce platform
 * @module API/Admin/Persons/Tags
 */

/**
 * @typedef {Object} TagInput
 * @property {string} tag_id - The ID of the tag to associate with the person
 * @property {string} [value] - Optional value for the tag
 * @property {string} [metadata] - Optional metadata for the tag
 */

/**
 * @typedef {Object} UpdateTagsInput
 * @property {string[]} add - Array of tag IDs to add to the person
 * @property {string[]} remove - Array of tag IDs to remove from the person
 */

/**
 * @typedef {Object} TagResponse
 * @property {string} id - The unique identifier of the tag
 * @property {string} value - The value of the tag
 * @property {string} [metadata] - Optional metadata associated with the tag
 * @property {Date} created_at - When the tag was created
 * @property {Date} updated_at - When the tag was last updated
 */

/**
 * @typedef {Object} TagsResponse
 * @property {TagResponse[]} tags - Array of tag objects associated with the person
 */

/**
 * Create a new tag for a person
 * @route POST /admin/persons/:id/tags
 * @group Person Tags - Operations related to person tags
 * @param {string} id.path.required - The ID of the person to add tags to
 * @param {TagInput} request.body.required - Tag data to create
 * @returns {TagsResponse} 201 - Created tag object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * POST /admin/persons/pers_123456789/tags
 * {
 *   "tag_id": "tag_987654321",
 *   "value": "VIP Customer",
 *   "metadata": "{\"priority\": \"high\"}"
 * }
 *
 * @example response 201
 * {
 *   "tags": [
 *     {
 *       "id": "tag_987654321",
 *       "value": "VIP Customer",
 *       "metadata": "{\"priority\": \"high\"}",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ]
 * }
 */

/**
 * Retrieve tags for a person
 * @route GET /admin/persons/:id/tags
 * @group Person Tags - Operations related to person tags
 * @param {string} id.path.required - The ID of the person to retrieve tags for
 * @returns {TagsResponse} 200 - Array of tag objects associated with the person
 * @throws {MedusaError} 400 - Invalid request
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * GET /admin/persons/pers_123456789/tags
 *
 * @example response 200
 * {
 *   "tags": [
 *     {
 *       "id": "tag_987654321",
 *       "value": "VIP Customer",
 *       "metadata": "{\"priority\": \"high\"}",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "tag_555555555",
 *       "value": "Newsletter Subscriber",
 *       "metadata": "{\"frequency\": \"weekly\"}",
 *       "created_at": "2023-01-02T00:00:00Z",
 *       "updated_at": "2023-01-02T00:00:00Z"
 *     }
 *   ]
 * }
 */

/**
 * Update tags for a person
 * @route PUT /admin/persons/:id/tags
 * @group Person Tags - Operations related to person tags
 * @param {string} id.path.required - The ID of the person to update tags for
 * @param {UpdateTagsInput} request.body.required - Tag update data
 * @returns {TagsResponse} 201 - Updated array of tag objects associated with the person
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * PUT /admin/persons/pers_123456789/tags
 * {
 *   "add": ["tag_111111111"],
 *   "remove": ["tag_555555555"]
 * }
 *
 * @example response 201
 * {
 *   "tags": [
 *     {
 *       "id": "tag_987654321",
 *       "value": "VIP Customer",
 *       "metadata": "{\"priority\": \"high\"}",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "tag_111111111",
 *       "value": "Loyalty Program",
 *       "metadata": "{\"tier\": \"gold\"}",
 *       "created_at": "2023-01-03T00:00:00Z",
 *       "updated_at": "2023-01-03T00:00:00Z"
 *     }
 *   ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {  deleteTagSchema, tagSchema, UpdateTagsForPerson } from "./validators";
import { TagAllowedFields, refetchPersonTags } from "./helpers";

import createPersonTagsWorkflow from "../../../../../workflows/persons/create-person-tags";
import retrievePersonTagsWorkflow from "../../../../../workflows/persons/retrieve-person-tags";
import updatePersonTagsWorkflow from "../../../../../workflows/persons/update-person-tags";

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


