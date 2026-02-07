/**
 * @file Admin API routes for managing person contacts
 * @description Provides endpoints for creating and retrieving contacts associated with a person in the JYT Commerce platform
 * @module API/Admin/Persons/Contacts
 */

/**
 * @typedef {Object} ContactInput
 * @property {string} type - The type of contact (e.g., email, phone, etc.)
 * @property {string} value - The contact value (e.g., email address, phone number)
 * @property {boolean} [is_primary=false] - Whether this is the primary contact
 * @property {string} [label] - Optional label for the contact
 */

/**
 * @typedef {Object} ContactResponse
 * @property {string} id - The unique identifier for the contact
 * @property {string} person_id - The ID of the associated person
 * @property {string} type - The type of contact
 * @property {string} value - The contact value
 * @property {boolean} is_primary - Whether this is the primary contact
 * @property {string} [label] - Optional label for the contact
 * @property {Date} created_at - When the contact was created
 * @property {Date} updated_at - When the contact was last updated
 */

/**
 * @typedef {Object} ContactListResponse
 * @property {ContactResponse[]} contacts - Array of contact objects
 * @property {number} count - Total count of contacts for the person
 */

/**
 * Create a new contact for a person
 * @route POST /admin/persons/:id/contacts
 * @group Person Contacts - Operations related to person contacts
 * @param {string} id.path.required - The ID of the person to associate the contact with
 * @param {ContactInput} request.body.required - Contact data to create
 * @returns {Object} 201 - Created contact object
 * @returns {ContactResponse} 201.contact - The created contact
 * @throws {MedusaError} 400 - Invalid input data or person not found
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * POST /admin/persons/pers_123456789/contacts
 * {
 *   "type": "email",
 *   "value": "john.doe@example.com",
 *   "is_primary": true,
 *   "label": "Work Email"
 * }
 *
 * @example response 201
 * {
 *   "contact": {
 *     "id": "cont_987654321",
 *     "person_id": "pers_123456789",
 *     "type": "email",
 *     "value": "john.doe@example.com",
 *     "is_primary": true,
 *     "label": "Work Email",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * List all contacts for a person
 * @route GET /admin/persons/:id/contacts
 * @group Person Contacts - Operations related to person contacts
 * @param {string} id.path.required - The ID of the person to retrieve contacts for
 * @returns {ContactListResponse} 200 - List of contacts for the person
 * @throws {MedusaError} 400 - Invalid person ID
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * GET /admin/persons/pers_123456789/contacts
 *
 * @example response 200
 * {
 *   "contacts": [
 *     {
 *       "id": "cont_987654321",
 *       "person_id": "pers_123456789",
 *       "type": "email",
 *       "value": "john.doe@example.com",
 *       "is_primary": true,
 *       "label": "Work Email",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "cont_123456789",
 *       "person_id": "pers_123456789",
 *       "type": "phone",
 *       "value": "+1234567890",
 *       "is_primary": false,
 *       "label": "Mobile",
 *       "created_at": "2023-01-02T00:00:00Z",
 *       "updated_at": "2023-01-02T00:00:00Z"
 *     }
 *   ],
 *   "count": 2
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { contactSchema } from "./validators";
import { ContactAllowedFields, refetchPersonContact } from "./helpers";
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
    const { result, errors } = await retrieveContactsWorkflow(req.scope).run({
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
