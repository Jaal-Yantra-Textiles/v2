/**
 * @file Admin API routes for managing person addresses
 * @description Provides endpoints for creating and retrieving addresses associated with persons in the JYT Commerce platform
 * @module API/Admin/Persons/Addresses
 */

/**
 * @typedef {Object} AddressInput
 * @property {string} first_name - The first name of the person
 * @property {string} last_name - The last name of the person
 * @property {string} address_1 - The first line of the address
 * @property {string} [address_2] - The second line of the address (optional)
 * @property {string} city - The city of the address
 * @property {string} country_code - The country code of the address (ISO 3166-1 alpha-2)
 * @property {string} postal_code - The postal code of the address
 * @property {string} [phone] - The phone number associated with the address (optional)
 * @property {string} [company] - The company name associated with the address (optional)
 * @property {string} [province] - The province or state of the address (optional)
 * @property {boolean} [is_default] - Whether this is the default address (optional)
 */

/**
 * @typedef {Object} AddressResponse
 * @property {string} id - The unique identifier of the address
 * @property {string} person_id - The ID of the person associated with the address
 * @property {string} first_name - The first name of the person
 * @property {string} last_name - The last name of the person
 * @property {string} address_1 - The first line of the address
 * @property {string} [address_2] - The second line of the address (optional)
 * @property {string} city - The city of the address
 * @property {string} country_code - The country code of the address (ISO 3166-1 alpha-2)
 * @property {string} postal_code - The postal code of the address
 * @property {string} [phone] - The phone number associated with the address (optional)
 * @property {string} [company] - The company name associated with the address (optional)
 * @property {string} [province] - The province or state of the address (optional)
 * @property {boolean} [is_default] - Whether this is the default address (optional)
 * @property {Date} created_at - When the address was created
 * @property {Date} updated_at - When the address was last updated
 */

/**
 * @typedef {Object} AddressListResponse
 * @property {AddressResponse[]} addresses - The list of addresses
 * @property {number} count - The total count of addresses
 */

/**
 * Create a new address for a person
 * @route POST /admin/persons/:id/addresses
 * @group Person Addresses - Operations related to person addresses
 * @param {string} id.path.required - The ID of the person to associate the address with
 * @param {AddressInput} request.body.required - Address data to create
 * @returns {Object} 201 - Created address object
 * @returns {AddressResponse} 201.address - The created address
 * @throws {MedusaError} 400 - Invalid input data or errors during address creation
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * POST /admin/persons/person_123456789/addresses
 * {
 *   "first_name": "John",
 *   "last_name": "Doe",
 *   "address_1": "123 Main St",
 *   "city": "New York",
 *   "country_code": "US",
 *   "postal_code": "10001",
 *   "phone": "+12125551234",
 *   "is_default": true
 * }
 *
 * @example response 201
 * {
 *   "address": {
 *     "id": "addr_987654321",
 *     "person_id": "person_123456789",
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "address_1": "123 Main St",
 *     "city": "New York",
 *     "country_code": "US",
 *     "postal_code": "10001",
 *     "phone": "+12125551234",
 *     "is_default": true,
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * Retrieve all addresses for a person
 * @route GET /admin/persons/:id/addresses
 * @group Person Addresses - Operations related to person addresses
 * @param {string} id.path.required - The ID of the person to retrieve addresses for
 * @returns {AddressListResponse} 200 - List of addresses and count
 * @throws {MedusaError} 400 - Errors during address retrieval
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * GET /admin/persons/person_123456789/addresses
 *
 * @example response 200
 * {
 *   "addresses": [
 *     {
 *       "id": "addr_987654321",
 *       "person_id": "person_123456789",
 *       "first_name": "John",
 *       "last_name": "Doe",
 *       "address_1": "123 Main St",
 *       "city": "New York",
 *       "country_code": "US",
 *       "postal_code": "10001",
 *       "phone": "+12125551234",
 *       "is_default": true,
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "addr_555666777",
 *       "person_id": "person_123456789",
 *       "first_name": "John",
 *       "last_name": "Doe",
 *       "address_1": "456 Secondary St",
 *       "city": "New York",
 *       "country_code": "US",
 *       "postal_code": "10002",
 *       "is_default": false,
 *       "created_at": "2023-01-02T00:00:00Z",
 *       "updated_at": "2023-01-02T00:00:00Z"
 *     }
 *   ],
 *   "count": 2
 * }
 */
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
