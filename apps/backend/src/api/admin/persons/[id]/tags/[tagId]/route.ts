/**
 * @file Admin API route for removing tags from persons
 * @description Provides an endpoint for deleting a specific tag from a person in the JYT Commerce platform
 * @module API/Admin/Persons/Tags
 */

/**
 * @typedef {Object} DeleteTagForPersonInput
 * @property {string} person_id - The ID of the person to remove the tag from
 * @property {string} id - The ID of the tag to be removed
 */

/**
 * @typedef {Object} TagResponse
 * @property {string} id - The unique identifier of the tag
 * @property {string} value - The value of the tag
 * @property {string} [created_at] - When the tag was created (ISO 8601 format)
 * @property {string} [updated_at] - When the tag was last updated (ISO 8601 format)
 */

/**
 * @typedef {Object} DeleteTagResponse
 * @property {TagResponse[]} tags - Array of remaining tags after deletion
 * @property {boolean} deleted - Indicates whether the deletion was successful
 */

/**
 * Delete a specific tag from a person
 * @route DELETE /admin/persons/:id/tags/:tagId
 * @group Person Tags - Operations related to person tags
 * @param {string} id.path.required - The ID of the person
 * @param {string} tagId.path.required - The ID of the tag to delete
 * @returns {DeleteTagResponse} 200 - Success response with remaining tags
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person or tag not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * DELETE /admin/persons/pers_123456789/tags/tag_987654321
 *
 * @example response 200
 * {
 *   "tags": [
 *     {
 *       "id": "tag_111111111",
 *       "value": "vip_customer",
 *       "created_at": "2023-01-15T10:30:00Z",
 *       "updated_at": "2023-01-15T10:30:00Z"
 *     },
 *     {
 *       "id": "tag_222222222",
 *       "value": "high_value",
 *       "created_at": "2023-02-20T14:45:00Z",
 *       "updated_at": "2023-02-20T14:45:00Z"
 *     }
 *   ],
 *   "deleted": true
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { TagAllowedFields } from "../helpers";
import deletePersonTagsWorkflow from "../../../../../../workflows/persons/delete-person-tags";
import { DeleteTagForPerson } from "../validators";

export const DELETE = async (
    req: MedusaRequest<DeleteTagForPerson> & {
      remoteQueryConfig?: {
        fields?: TagAllowedFields[];
      };
    },
    res: MedusaResponse,
  ) => {
  
    const personId = req.params.id;
    const tagId = req.params.tagId;
    try {
      const { result, errors } = await deletePersonTagsWorkflow.run({
        input: {
          person_id: personId,
          id: tagId
        },
      });
  
      if (errors.length > 0) {
        console.warn("Error reported at", errors);
        throw errors;
      }
  
      res.status(200).json({ tags: result, deleted: true });
    } catch (error) {
      throw error;
    }
  };