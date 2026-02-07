/**
 * @file Admin API routes for managing person addresses
 * @description Provides endpoints for updating and deleting addresses associated with persons in the JYT Commerce platform
 * @module API/Admin/Persons/Addresses
 */

/**
 * @typedef {Object} AddressInput
 * @property {string} [first_name] - The first name of the person
 * @property {string} [last_name] - The last name of the person
 * @property {string} [company] - The company name
 * @property {string} [address_1] - The first line of the address
 * @property {string} [address_2] - The second line of the address
 * @property {string} [city] - The city
 * @property {string} [country_code] - The country code (ISO 2-letter format)
 * @property {string} [province] - The province or state
 * @property {string} [postal_code] - The postal code
 * @property {string} [phone] - The phone number
 * @property {string} [metadata] - Additional metadata as key-value pairs
 */

/**
 * @typedef {Object} AddressResponse
 * @property {string} id - The unique identifier of the address
 * @property {string} person_id - The ID of the person this address belongs to
 * @property {string} first_name - The first name of the person
 * @property {string} last_name - The last name of the person
 * @property {string} company - The company name
 * @property {string} address_1 - The first line of the address
 * @property {string} address_2 - The second line of the address
 * @property {string} city - The city
 * @property {string} country_code - The country code (ISO 2-letter format)
 * @property {string} province - The province or state
 * @property {string} postal_code - The postal code
 * @property {string} phone - The phone number
 * @property {Object} metadata - Additional metadata as key-value pairs
 * @property {Date} created_at - When the address was created
 * @property {Date} updated_at - When the address was last updated
 */

/**
 * Update an address for a person
 * @route POST /admin/persons/:id/addresses/:addressId
 * @group Person Address - Operations related to person addresses
 * @param {string} id.path.required - The ID of the person
 * @param {string} addressId.path.required - The ID of the address to update
 * @param {AddressInput} request.body.required - Address data to update
 * @param {string[]} [remoteQueryConfig.fields] - Fields to include in the response (e.g., ["id", "first_name"])
 * @returns {Object} 200 - Updated address object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 404 - Address not found for the specified person
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/persons/pers_123456789/addresses/addr_987654321
 * {
 *   "first_name": "John",
 *   "last_name": "Doe",
 *   "address_1": "123 Main St",
 *   "city": "New York",
 *   "country_code": "US",
 *   "postal_code": "10001"
 * }
 *
 * @example response 200
 * {
 *   "address": {
 *     "id": "addr_987654321",
 *     "person_id": "pers_123456789",
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "company": null,
 *     "address_1": "123 Main St",
 *     "address_2": null,
 *     "city": "New York",
 *     "country_code": "US",
 *     "province": "NY",
 *     "postal_code": "10001",
 *     "phone": null,
 *     "metadata": {},
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z"
 *   }
 * }
 */

/**
 * Delete an address for a person
 * @route DELETE /admin/persons/:id/addresses/:addressId
 * @group Person Address - Operations related to person addresses
 * @param {string} id.path.required - The ID of the person
 * @param {string} addressId.path.required - The ID of the address to delete
 * @returns {void} 204 - Address successfully deleted
 * @throws {MedusaError} 404 - Address not found for the specified person
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * DELETE /admin/persons/pers_123456789/addresses/addr_987654321
 *
 * @example response 204
 * No content
 */
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
