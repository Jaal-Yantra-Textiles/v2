/**
 * @file Admin API route for unsuspending users
 * @description Provides an endpoint to unsuspend a user account in the JYT Commerce platform
 * @module API/Admin/Users
 */

/**
 * @typedef {Object} UnsuspendUserResponse
 * @property {boolean} suspended - Indicates whether the user is suspended (false after successful unsuspension)
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {Array<Object>} errors - Array of error objects
 * @property {string} errors[].message - Error message
 * @property {string} errors[].code - Error code
 * @property {string} [errors[].type] - Error type
 */

/**
 * Unsuspend a user account
 * @route POST /admin/users/:id/unsuspend
 * @group User - Operations related to user management
 * @param {string} id.path.required - The ID of the user to unsuspend
 * @returns {UnsuspendUserResponse} 200 - User successfully unsuspended
 * @throws {ErrorResponse} 400 - Invalid user ID or unsuspension failed
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - User not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/users/usr_123456789/unsuspend
 *
 * @example response 200
 * {
 *   "suspended": false
 * }
 *
 * @example response 400
 * {
 *   "errors": [
 *     {
 *       "message": "User is not suspended",
 *       "code": "user_not_suspended",
 *       "type": "invalid_operation"
 *     }
 *   ]
 * }
 *
 * @example response 404
 * {
 *   "errors": [
 *     {
 *       "message": "User not found",
 *       "code": "user_not_found",
 *       "type": "not_found"
 *     }
 *   ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { unsuspendUserWorkflow } from "../../../../../workflows/users/unsuspend-user";

export const POST = async (
    req: MedusaRequest,
    res: MedusaResponse
) => {
    const { id } = req.params;
    const { result, errors } = await unsuspendUserWorkflow(req.scope).run({
        input: {
            userId: id
        }
    });

    if (errors && errors.length > 0) {
        return res.status(400).json({ errors });
    }

    res.status(200).json({
        suspended: false
    });
};
