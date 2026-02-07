/**
 * @file Admin API routes for managing persons
 * @description Provides endpoints for creating and listing persons in the JYT Commerce platform
 * @module API/Admin/Persons
 */

/**
 * @typedef {Object} PersonInput
 * @property {string} first_name - The first name of the person
 * @property {string} last_name - The last name of the person
 * @property {string} email - The email address of the person
 * @property {string} [phone] - The phone number of the person
 * @property {string} [state] - The state of the person (active/inactive)
 * @property {Object} [metadata] - Additional metadata for the person
 */

/**
 * @typedef {Object} PersonResponse
 * @property {string} id - The unique identifier of the person
 * @property {string} first_name - The first name of the person
 * @property {string} last_name - The last name of the person
 * @property {string} email - The email address of the person
 * @property {string} [phone] - The phone number of the person
 * @property {string} [state] - The state of the person (active/inactive)
 * @property {Date} created_at - When the person was created
 * @property {Date} updated_at - When the person was last updated
 * @property {Object} [metadata] - Additional metadata for the person
 */

/**
 * @typedef {Object} ListPersonsQuery
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=10] - Number of items to return
 * @property {string} [q] - Search query for filtering persons
 * @property {string} [first_name] - Filter by first name
 * @property {string} [last_name] - Filter by last name
 * @property {string} [email] - Filter by email
 * @property {string} [state] - Filter by state (active/inactive)
 * @property {boolean} [withDeleted=false] - Include deleted persons in the results
 * @property {string[]} [fields] - Fields to include in the response
 */

/**
 * @typedef {Object} ListPersonsResponse
 * @property {PersonResponse[]} persons - Array of person objects
 * @property {number} count - Total count of persons matching the query
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Current pagination limit
 */

/**
 * Create a new person
 * @route POST /admin/persons
 * @group Person - Operations related to persons
 * @param {PersonInput} request.body.required - Person data to create
 * @param {Object} [request.remoteQueryConfig] - Configuration for remote queries
 * @param {string[]} [request.remoteQueryConfig.fields] - Fields to include in the response
 * @returns {Object} 201 - Created person object
 * @returns {PersonResponse} 201.person - The created person
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/persons
 * {
 *   "first_name": "John",
 *   "last_name": "Doe",
 *   "email": "john.doe@example.com",
 *   "phone": "+1234567890",
 *   "state": "active",
 *   "metadata": {
 *     "department": "Marketing"
 *   }
 * }
 *
 * @example response 201
 * {
 *   "person": {
 *     "id": "person_123456789",
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "email": "john.doe@example.com",
 *     "phone": "+1234567890",
 *     "state": "active",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "metadata": {
 *       "department": "Marketing"
 *     }
 *   }
 * }
 */

/**
 * List persons with pagination and filtering
 * @route GET /admin/persons
 * @group Person - Operations related to persons
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=10] - Number of items to return
 * @param {string} [q] - Search query for filtering persons
 * @param {string} [first_name] - Filter by first name
 * @param {string} [last_name] - Filter by last name
 * @param {string} [email] - Filter by email
 * @param {string} [state] - Filter by state (active/inactive)
 * @param {boolean} [withDeleted=false] - Include deleted persons in the results
 * @param {string[]} [fields] - Fields to include in the response
 * @returns {ListPersonsResponse} 200 - Paginated list of persons
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/persons?offset=0&limit=10&q=john&state=active
 *
 * @example response 200
 * {
 *   "persons": [
 *     {
 *       "id": "person_123456789",
 *       "first_name": "John",
 *       "last_name": "Doe",
 *       "email": "john.doe@example.com",
 *       "phone": "+1234567890",
 *       "state": "active",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "metadata": {
 *         "department": "Marketing"
 *       }
 *     }
 *   ],
 *   "count": 1,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
import {
  MedusaRequest,
  MedusaResponse,
  
} from "@medusajs/framework/http";
import { Person, ListPersonsQuery } from "./validators";
import createPersonWorkflow from "../../../workflows/create-person";
import { PersonAllowedFields, refetchPerson } from "./helpers";
import { listAndCountPersonsWithFilterWorkflow } from "../../../workflows/persons/list-and-count-with-filter/list-and-count-with-filter";

export const POST = async (
  req: MedusaRequest<Person> & {
    remoteQueryConfig?: {
      fields?: PersonAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const { result, errors, transaction } = await createPersonWorkflow.run({
    input: req.validatedBody,
  });
  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }
  const person = await refetchPerson(
    result.id,
    req.scope,
    req.remoteQueryConfig?.fields || ["*"],
  );
  res.status(201).json({ person });
};

export const GET = async (req: MedusaRequest<ListPersonsQuery>, res: MedusaResponse) => {
  
  try {
    // Use the validated query parameters
    const query = req.validatedQuery;
    const fields = req.validatedQuery.fields;
    // Extract filters directly from the validated query
    // This works because our validator schema matches the filter fields
    const filters = {
      q: query.q,
      first_name: query.first_name,
      last_name: query.last_name,
      email: query.email,
      state: query.state
    };
    // Get the validated limit and offset
    const { result:persons, errors } = await listAndCountPersonsWithFilterWorkflow(req.scope).run({
      input: {
        filters,
        pagination: {
          take: query.limit,
          skip: query.offset,
          order: {
            created_at: 'ASC'
          }
        },
        withDeleted: Boolean(query.withDeleted),
        fields: fields || '*'
      }
    })

    
    res.status(200).json({
      persons: persons.data,
      count: persons.metadata?.count,
      offset: req.query.offset || 0,
      limit: req.query.limit || 10,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
