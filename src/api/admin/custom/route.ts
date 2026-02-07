/**
 * @file Admin API route for custom operations
 * @description Provides endpoints for custom operations in the JYT Commerce platform
 * @module API/Admin/Custom
 */

/**
 * @typedef {Object} CustomResponse
 * @property {string} status - The status of the response
 * @property {string} message - A descriptive message about the response
 */

/**
 * Get custom endpoint status
 * @route GET /admin/custom
 * @group Custom - Operations related to custom functionality
 * @returns {CustomResponse} 200 - Success response indicating the endpoint is operational
 * @throws {MedusaError} 401 - Unauthorized access
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/custom
 *
 * @example response 200
 * {
 *   "status": "success",
 *   "message": "Custom endpoint is operational"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  res.sendStatus(200);
}
