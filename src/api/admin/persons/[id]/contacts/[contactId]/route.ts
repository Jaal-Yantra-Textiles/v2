/**
 * @file Admin API routes for managing person contacts
 * @description Provides endpoints for updating and deleting contacts associated with persons in the JYT Commerce platform
 * @module API/Admin/Persons/Contacts
 */

/**
 * @typedef {Object} ContactInput
 * @property {string} [first_name] - The first name of the contact
 * @property {string} [last_name] - The last name of the contact
 * @property {string} [email] - The email address of the contact
 * @property {string} [phone] - The phone number of the contact
 * @property {string} [title] - The job title of the contact
 * @property {string} [company] - The company name of the contact
 * @property {string} [address] - The address of the contact
 * @property {string} [city] - The city of the contact
 * @property {string} [state] - The state of the contact
 * @property {string} [country] - The country of the contact
 * @property {string} [postal_code] - The postal code of the contact
 * @property {string} [notes] - Additional notes about the contact
 */

/**
 * @typedef {Object} ContactResponse
 * @property {string} id - The unique identifier of the contact
 * @property {string} person_id - The unique identifier of the associated person
 * @property {string} first_name - The first name of the contact
 * @property {string} last_name - The last name of the contact
 * @property {string} email - The email address of the contact
 * @property {string} phone - The phone number of the contact
 * @property {string} title - The job title of the contact
 * @property {string} company - The company name of the contact
 * @property {string} address - The address of the contact
 * @property {string} city - The city of the contact
 * @property {string} state - The state of the contact
 * @property {string} country - The country of the contact
 * @property {string} postal_code - The postal code of the contact
 * @property {string} notes - Additional notes about the contact
 * @property {Date} created_at - When the contact was created
 * @property {Date} updated_at - When the contact was last updated
 */

/**
 * Update a contact for a person
 * @route POST /admin/persons/:id/contacts/:contactId
 * @group Person Contacts - Operations related to person contacts
 * @param {string} id.path.required - The unique identifier of the person
 * @param {string} contactId.path.required - The unique identifier of the contact
 * @param {ContactInput} request.body.required - Contact data to update
 * @returns {Object} 200 - Updated contact object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 404 - Contact not found for the specified person
 *
 * @example request
 * POST /admin/persons/pers_123456789/contacts/cont_987654321
 * {
 *   "first_name": "John",
 *   "last_name": "Doe",
 *   "email": "john.doe@example.com",
 *   "phone": "+1234567890",
 *   "title": "Manager",
 *   "company": "Acme Inc",
 *   "address": "123 Main St",
 *   "city": "New York",
 *   "state": "NY",
 *   "country": "US",
 *   "postal_code": "10001",
 *   "notes": "Primary contact for Acme Inc"
 * }
 *
 * @example response 200
 * {
 *   "contact": {
 *     "id": "cont_987654321",
 *     "person_id": "pers_123456789",
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "email": "john.doe@example.com",
 *     "phone": "+1234567890",
 *     "title": "Manager",
 *     "company": "Acme Inc",
 *     "address": "123 Main St",
 *     "city": "New York",
 *     "state": "NY",
 *     "country": "US",
 *     "postal_code": "10001",
 *     "notes": "Primary contact for Acme Inc",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z"
 *   }
 * }
 */

/**
 * Delete a contact for a person
 * @route DELETE /admin/persons/:id/contacts/:contactId
 * @group Person Contacts - Operations related to person contacts
 * @param {string} id.path.required - The unique identifier of the person
 * @param {string} contactId.path.required - The unique identifier of the contact
 * @returns {void} 204 - Contact successfully deleted
 * @throws {MedusaError} 404 - Contact not found for the specified person
 *
 * @example request
 * DELETE /admin/persons/pers_123456789/contacts/cont_987654321
 *
 * @example response 204
 * No content
 */
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
    throw error;
  }
};
