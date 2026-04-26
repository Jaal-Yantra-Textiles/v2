/**
 * @file Admin API route for suspending users
 * @description Provides an endpoint for suspending a specific user in the JYT Commerce platform
 * @module API/Admin/Users
 */

/**
 * @typedef {Object} SuspendUserResponse
 * @property {boolean} suspended - Indicates whether the user was successfully suspended
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {string} message - Error message describing what went wrong
 * @property {string} code - Error code identifying the type of error
 * @property {string} type - Type of error (e.g., "invalid_data", "database_error")
 */

/**
 * Suspend a user by ID
 * @route POST /admin/users/:id/suspend
 * @group User - Operations related to users
 * @param {string} id.path.required - The ID of the user to suspend
 * @returns {SuspendUserResponse} 200 - User successfully suspended
 * @throws {ErrorResponse} 400 - Invalid user ID or suspension failed
 * @throws {ErrorResponse} 401 - Unauthorized
 * @throws {ErrorResponse} 404 - User not found
 * @throws {ErrorResponse} 500 - Internal server error
 *
 * @example request
 * POST /admin/users/usr_123456789/suspend
 *
 * @example response 200
 * {
 *   "suspended": true
 * }
 *
 * @example response 400
 * {
 *   "errors": [
 *     {
 *       "message": "User suspension failed due to validation errors",
 *       "code": "suspension_error",
 *       "type": "invalid_data"
 *     }
 *   ]
 * }
 *
 * @example response 404
 * {
 *   "errors": [
 *     {
 *       "message": "User with ID usr_123456789 not found",
 *       "code": "not_found",
 *       "type": "database_error"
 *     }
 *   ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { suspendUserWorkflow } from "../../../../../workflows/users/suspend-user";

export const POST = async (
    req: MedusaRequest,
    res: MedusaResponse
) => {
    const { id } = req.params
    const { result, errors } = await suspendUserWorkflow(req.scope).run({
        input: {
            userId: id
        }
    })

    if (errors.length > 0) {   
        return res.status(400).json(errors)
    }
   res.status(200).json({
    suspended: true
   })
}