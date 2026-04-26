/**
 * @file Admin API routes for managing user authentication identities
 * @description Provides endpoints for listing user authentication identities in the JYT Commerce platform
 * @module API/Admin/Users/Identities
 */

/**
 * @typedef {Object} ListIdentitiesQuery
 * @property {string} email - The email address of the user whose identities should be listed
 */

/**
 * @typedef {Object} AuthIdentity
 * @property {string} provider_id - The unique identifier of the authentication provider
 * @property {string} provider - The name of the authentication provider (e.g., "emailpass", "google", "facebook")
 * @property {string} user_id - The unique identifier of the user associated with this identity
 * @property {string} email - The email address associated with this identity
 * @property {Date} created_at - When the identity was created
 * @property {Date} updated_at - When the identity was last updated
 */

/**
 * @typedef {Object} ListIdentitiesResponse
 * @property {AuthIdentity[]} identities - Array of authentication identities
 */

/**
 * List user authentication identities
 * @route GET /admin/users/identities
 * @group User - Operations related to users
 * @param {string} email.query.required - The email address of the user whose identities should be listed
 * @returns {ListIdentitiesResponse} 200 - List of authentication identities for the specified user
 * @throws {MedusaError} 400 - Invalid email parameter
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - User not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/users/identities?email=user@example.com
 *
 * @example response 200
 * {
 *   "identities": [
 *     {
 *       "provider_id": "auth_123456789",
 *       "provider": "emailpass",
 *       "user_id": "usr_987654321",
 *       "email": "user@example.com",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-02T00:00:00Z"
 *     },
 *     {
 *       "provider_id": "auth_987654321",
 *       "provider": "google",
 *       "user_id": "usr_987654321",
 *       "email": "user@example.com",
 *       "created_at": "2023-02-01T00:00:00Z",
 *       "updated_at": "2023-02-02T00:00:00Z"
 *     }
 *   ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ListIdentitiesQuery } from "./validators"
import { listUserAuthIdentitiesWorkflow } from "../../../../workflows/users/list-auth-identities"

export const GET = async (
  req: MedusaRequest<ListIdentitiesQuery>,
  res: MedusaResponse
) => {
  // req.validatedQuery will be set by middleware
  const { email } = req.validatedQuery as ListIdentitiesQuery

  const { result, errors } = await listUserAuthIdentitiesWorkflow(req.scope).run({
    input: { email },
  })

  if (errors?.length) {
    // Let global error handler process
    throw errors[0].error || new Error("Failed to list auth identities")
  }

  // result is the provider identities array from the step
  return res.status(200).json({ identities: result })
}
